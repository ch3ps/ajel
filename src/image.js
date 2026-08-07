import fs from 'node:fs';
import path from 'node:path';
import { config, log } from './config.js';
import { resolvePortrait } from './people.js';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'AjelNewsBot/0.1 (Snapchat Arabic news renderer; contact: youngliren41@gmail.com)';

const REJECT_TITLE = /logo|icon|map|diagram|chart|seal|emblem|coat[_ ]of[_ ]arms|banner|screenshot|scheme|graph|montage|collage|signature|stamp/i;

// The story canvas. An image is only acceptable if covering this frame needs
// little or no upscaling — that is what keeps the render sharp.
const CANVAS_W = 1080;
const CANVAS_H = 1920;
const MAX_UPSCALE = 1.15;

// How much the delivered pixels must be stretched to cover the 1080x1920 frame.
// <= 1 means the image is downscaled (always crisp).
function coverScale(width, height) {
  return Math.max(CANVAS_W / width, CANVAS_H / height);
}

// A portrait in a 2-up split only has to fill half the width.
function coverScaleForPanel({ width, height }, panelCount) {
  const panelWidth = CANVAS_W / Math.max(panelCount, 1);
  return Math.max(panelWidth / width, CANVAS_H / height);
}

async function commonsQuery(params) {
  const url = new URL(COMMONS_API);
  for (const [k, v] of Object.entries({ action: 'query', format: 'json', origin: '*', ...params })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Commons API HTTP ${res.status}`);
  return res.json();
}

function scoreCandidate(info, title, queryTokens) {
  if (!info || !info.thumburl) return -1;
  const mime = info.mime || '';
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return -1;
  if (REJECT_TITLE.test(title)) return -1;
  const aspect = info.width / info.height;
  if (aspect < 0.45 || aspect > 2.4) return -1;

  // Quality gate: judge the pixels actually delivered, not the source file, and
  // reject anything that would have to be stretched to fill the story frame.
  const tw = info.thumbwidth || info.width;
  const th = info.thumbheight || info.height;
  const scale = coverScale(tw, th);
  if (scale > MAX_UPSCALE) return -1;

  let score = 0;
  if (mime === 'image/jpeg') score += 3; // photos are almost always jpeg on Commons
  if (scale <= 0.7) score += 3;          // plenty of headroom — downscaled, very sharp
  else if (scale <= 1.0) score += 2;     // native or better
  const t = title.toLowerCase();
  let overlap = 0;
  for (const tok of queryTokens) {
    if (tok.length >= 3 && t.includes(tok)) overlap++;
  }
  score += Math.min(overlap, 3);
  // editorial preference: official/press photos over candid event shots
  if (/portrait|official|summit|meeting|press|visit|conference/i.test(title)) score += 2;
  // group shots ("X with Y", "X, Y and Z") drag unrelated people into the frame
  if (/\bwith\b|\band\b|,/i.test(title.replace(/^File:/i, ''))) score -= 3;
  return score;
}

async function searchCommons(query) {
  const data = await commonsQuery({
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '30',
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    // Ask for 2160px-wide renders: enough that a portrait crop of the story
    // frame is still downscaling. MediaWiki caps this at the original width for
    // photos, so thumbwidth/thumbheight tell us what we actually get.
    iiurlwidth: '2160',
  });
  const pages = Object.values(data?.query?.pages || {});
  const queryTokens = query.toLowerCase().split(/\s+/);
  let best = null;
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const score = scoreCandidate(info, page.title || '', queryTokens);
    if (score >= 4 && (!best || score > best.score)) {
      best = {
        score,
        url: info.thumburl,
        title: page.title,
        width: info.thumbwidth || info.width,
        height: info.thumbheight || info.height,
      };
    }
  }
  return best;
}

// Flags are shown as sharp chips over the category gradient rather than as a
// full-bleed background: a 3:2 flag cropped to 9:16 loses most of its design,
// and chips stay crisp (SVG source, rendered at 4x display size) for every
// country while also showing every party to the story.
async function flagOf(isoCode) {
  let name;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'region' }).of(isoCode.toUpperCase());
  } catch {
    return null;
  }
  if (!name) return null;
  const data = await commonsQuery({
    titles: `File:Flag of ${name}.svg`,
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    iiurlwidth: '640',
  });
  const page = Object.values(data?.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  return info?.thumburl ? { url: info.thumburl, title: page.title } : null;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`image download HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// Deterministic, license-safe fallback chain. Returns either
// { kind: 'image', path, credit } or { kind: 'css' } (template renders a
// category-themed gradient). Sensitive stories skip entity photos entirely so a
// person's face is never paired with a death/crime/arrest headline.
export async function pickBackground(analysis) {
  const dest = path.join(config.workDir, 'bg.jpg');
  const unsafe = analysis.person_photo_unsafe;

  // Tier 1 — the faces behind the story. Offices are resolved to their current
  // holder through Wikidata, so this stays correct as governments change.
  if (!unsafe) {
    const portraits = [];
    for (const subject of (analysis.people || []).slice(0, 2)) {
      const portrait = await resolvePortrait(subject);
      if (!portrait) continue;
      if (coverScaleForPanel(portrait, (analysis.people || []).length) > MAX_UPSCALE) {
        log('background.portrait_too_small', { name: portrait.name, pixels: `${portrait.width}x${portrait.height}` });
        continue;
      }
      const file = path.join(config.workDir, `person${portraits.length}.jpg`);
      try {
        await download(portrait.url, file);
        portraits.push({ path: file, name: portrait.name, viaOffice: portrait.viaOffice });
      } catch (err) {
        log('background.portrait_download_error', { name: portrait.name, error: String(err) });
      }
    }
    if (portraits.length) {
      log('background.portraits', {
        people: portraits.map((p) => (p.viaOffice ? `${p.name} (${p.viaOffice})` : p.name)),
      });
      return { kind: 'portraits', paths: portraits.map((p) => p.path), names: portraits.map((p) => p.name) };
    }
  }

  if (!unsafe) {
    for (const entity of analysis.entities || []) {
      try {
        const hit = await searchCommons(entity.wikimedia_query);
        if (hit) {
          await download(hit.url, dest);
          log('background.commons', {
            query: entity.wikimedia_query,
            title: hit.title,
            score: hit.score,
            pixels: `${hit.width}x${hit.height}`,
          });
          return { kind: 'photo', path: dest, credit: 'Wikimedia Commons' };
        }
      } catch (err) {
        log('background.commons_error', { query: entity.wikimedia_query, error: String(err) });
      }
    }
  }

  const flagFiles = [];
  for (const iso of (analysis.countries || []).slice(0, 3)) {
    try {
      const flag = await flagOf(iso);
      if (flag) {
        const file = path.join(config.workDir, `flag${flagFiles.length}.png`);
        await download(flag.url, file);
        flagFiles.push(file);
      }
    } catch (err) {
      log('background.flag_error', { country: iso, error: String(err) });
    }
  }
  if (flagFiles.length) {
    log('background.flags', { countries: analysis.countries.slice(0, 3), count: flagFiles.length });
    return { kind: 'flags', paths: flagFiles, credit: 'Wikimedia Commons' };
  }

  log('background.css_fallback', { category: analysis.category });
  return { kind: 'css' };
}
