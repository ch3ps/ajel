import * as cheerio from 'cheerio';
import { pathToFileURL } from 'node:url';
import { config, log } from './config.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const BROWSER_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

// The site's bot protection rejects plain HTTP clients coming from datacenter
// IPs (403 on GitHub Actions, fine from a home connection). Driving real
// Chromium — which we already ship for rendering — presents a genuine browser
// fingerprint and gets through.
async function fetchHtmlViaBrowser() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: UA, locale: 'en-US' });
    const page = await context.newPage();
    const res = await page.goto(config.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (res && !res.ok()) throw new Error(`browser fetch got HTTP ${res.status()}`);
    await page.waitForSelector('a[href^="/en/"]', { timeout: 20000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function fetchHtml() {
  try {
    const res = await fetch(config.sourceUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return await res.text();
    log('scrape.http_blocked', { status: res.status, fallback: 'browser' });
  } catch (err) {
    log('scrape.http_error', { error: String(err), fallback: 'browser' });
  }
  return fetchHtmlViaBrowser();
}

// The site is Nuxt with full SSR: every feed item is an <a href="/en/<id>">
// containing .postime and .content divs.
export async function fetchPosts() {
  const $ = cheerio.load(await fetchHtml());

  const posts = [];
  $('a[href^="/en/"]').each((_, el) => {
    const $el = $(el);
    const content = $el.find('.content').first();
    if (!content.length) return;
    const href = $el.attr('href') || '';
    const id = href.split('/').pop();
    if (!id) return;
    // The feed appends t.co tracking links; they add nothing for a translated
    // card and only confuse the model.
    const text = content
      .text()
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
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
