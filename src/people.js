import { log } from './config.js';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'AjelNewsBot/0.1 (Snapchat Arabic news renderer; contact: youngliren41@gmail.com)';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';

const P_INSTANCE_OF = 'P31';
const P_IMAGE = 'P18';
const P_OFFICEHOLDER = 'P1308';
const P_END_TIME = 'P582';
const P_START_TIME = 'P580';
const Q_HUMAN = 'Q5';

async function api(base, params) {
  const url = new URL(base);
  for (const [k, v] of Object.entries({ format: 'json', origin: '*', ...params })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`${base} HTTP ${res.status}`);
  return res.json();
}

async function searchEntities(query, limit = 5) {
  const data = await api(WIKIDATA_API, {
    action: 'wbsearchentities',
    search: query,
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: String(limit),
  });
  return (data?.search || []).map((s) => s.id);
}

async function searchEntity(query) {
  return (await searchEntities(query, 5))[0] || null;
}

async function getEntity(qid) {
  const data = await api(WIKIDATA_API, {
    action: 'wbgetentities',
    ids: qid,
    props: 'claims|labels',
    languages: 'en',
  });
  return data?.entities?.[qid] || null;
}

function claimValues(entity, prop) {
  return (entity?.claims?.[prop] || []).filter((c) => c.mainsnak?.datavalue);
}

function isHuman(entity) {
  return claimValues(entity, P_INSTANCE_OF).some((c) => c.mainsnak.datavalue.value?.id === Q_HUMAN);
}

// Wikidata tracks who currently holds an office, so office → person is resolved
// from live data instead of the model's training memory (which goes stale and
// would put the wrong face on the news).
async function currentOfficeholder(officeQid) {
  const office = await getEntity(officeQid);
  const statements = claimValues(office, P_OFFICEHOLDER);
  if (!statements.length) return null;

  const current = statements.filter((s) => !s.qualifiers?.[P_END_TIME]);
  const pool = current.length ? current : statements;
  // Prefer the statement Wikidata itself marks as current, then the latest start date.
  pool.sort((a, b) => {
    const rank = (s) => (s.rank === 'preferred' ? 2 : s.rank === 'normal' ? 1 : 0);
    if (rank(b) !== rank(a)) return rank(b) - rank(a);
    const start = (s) => s.qualifiers?.[P_START_TIME]?.[0]?.datavalue?.value?.time || '';
    return start(b).localeCompare(start(a));
  });
  return pool[0]?.mainsnak?.datavalue?.value?.id || null;
}

// Many office items (e.g. "Crown Prince of Saudi Arabia") carry no P1308
// officeholder claim; instead the person carries "position held" (P39) pointing
// back at the office. Ask the query service who currently holds it.
async function officeholderViaPositionHeld(officeQid) {
  const sparql = `SELECT ?person WHERE {
    ?person p:P39 ?statement .
    ?statement ps:P39 wd:${officeQid} .
    FILTER NOT EXISTS { ?statement pq:P582 ?endTime }
    ?person wdt:P18 ?image .
  } LIMIT 1`;
  const url = new URL(SPARQL_ENDPOINT);
  url.searchParams.set('query', sparql);
  url.searchParams.set('format', 'json');
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const uri = data?.results?.bindings?.[0]?.person?.value;
  return uri ? uri.split('/').pop() : null;
}

// A search for an office title often ranks the current holder above the office
// itself, so try every candidate: office items get resolved to their holder,
// and a person match is accepted as a last resort.
async function resolveOffice(officeLabel) {
  const candidates = await searchEntities(officeLabel, 5);
  let humanFallback = null;

  for (const qid of candidates) {
    const entity = await getEntity(qid);
    if (!entity) continue;
    if (isHuman(entity)) {
      humanFallback ??= qid;
      continue;
    }
    const holder =
      (await currentOfficeholder(qid)) || (await officeholderViaPositionHeld(qid));
    if (holder) return { qid: holder, viaOffice: officeLabel };
  }
  return humanFallback ? { qid: humanFallback, viaOffice: officeLabel } : null;
}

async function commonsImageUrl(fileName) {
  const data = await api(COMMONS_API, {
    action: 'query',
    titles: `File:${fileName}`,
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    iiurlwidth: '2160',
  });
  const page = Object.values(data?.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.thumburl) return null;
  return {
    url: info.thumburl,
    width: info.thumbwidth || info.width,
    height: info.thumbheight || info.height,
  };
}

// Resolves one requested subject to a canonical portrait.
// subject: { type: 'named_person' | 'office', value: string }
export async function resolvePortrait(subject) {
  try {
    let qid = null;
    let viaOffice = null;

    if (subject.type === 'office') {
      const holder = await resolveOffice(subject.value);
      if (holder) {
        qid = holder.qid;
        viaOffice = holder.viaOffice;
      }
    } else {
      qid = await searchEntity(subject.value);
    }
    if (!qid) return null;

    const person = await getEntity(qid);
    if (!person || !isHuman(person)) return null;

    // P18 is the canonical portrait a human curator chose for this person —
    // far more reliable than a keyword search over Commons filenames.
    const imageClaim = claimValues(person, P_IMAGE)[0];
    if (!imageClaim) return null;
    const image = await commonsImageUrl(imageClaim.mainsnak.datavalue.value);
    if (!image) return null;

    return {
      name: person.labels?.en?.value || subject.value,
      qid,
      viaOffice,
      ...image,
    };
  } catch (err) {
    log('people.resolve_error', { subject: subject.value, error: String(err) });
    return null;
  }
}
