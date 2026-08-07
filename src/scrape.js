import * as cheerio from 'cheerio';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// The site is Nuxt with full SSR: every feed item is an <a href="/en/<id>">
// containing .postime and .content divs, so plain fetch + cheerio is enough.
export async function fetchPosts() {
  const res = await fetch(config.sourceUrl, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Spectator Index fetch failed: HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  const posts = [];
  $('a[href^="/en/"]').each((_, el) => {
    const $el = $(el);
    const content = $el.find('.content').first();
    if (!content.length) return;
    const href = $el.attr('href') || '';
    const id = href.split('/').pop();
    if (!id) return;
    const text = content.text().replace(/\s+/g, ' ').trim();
    const timeText = $el.find('.postime').first().text().trim();
    const postedAt = timeText ? new Date(timeText) : null;
    posts.push({
      id,
      url: new URL(href, config.sourceUrl).href,
      text,
      timeText,
      postedAt: postedAt && !isNaN(postedAt) ? postedAt : null,
    });
  });
  return posts; // site lists newest first
}

export function breakingOnly(posts) {
  return posts.filter((p) => /^BREAKING\b/i.test(p.text));
}

export function isFresh(post, maxAgeHours = config.maxItemAgeHours) {
  if (!post.postedAt) return true; // unknown timestamp: let it through, dedup still protects us
  return Date.now() - post.postedAt.getTime() <= maxAgeHours * 3600 * 1000;
}

// CLI: `npm run scrape` prints the current BREAKING items
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const posts = await fetchPosts();
  const breaking = breakingOnly(posts);
  console.log(`total items: ${posts.length}, BREAKING: ${breaking.length}\n`);
  for (const p of breaking) {
    console.log(`[${p.timeText}] (${p.id}) fresh=${isFresh(p)}\n  ${p.text}\n`);
  }
}
