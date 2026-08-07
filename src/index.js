import fs from 'node:fs';
import path from 'node:path';
import { config, log } from './config.js';
import { loadState, saveState, markSeen, minutesSinceLastPost } from './state.js';
import { fetchPosts, breakingOnly, isFresh } from './scrape.js';
import { analyzePost } from './analyze.js';
import { pickBackground } from './image.js';
import { renderStory } from './render.js';
import { hostImage } from './media.js';
import { postStory } from './post.js';

async function main() {
  const state = loadState();
  const posts = await fetchPosts();
  const breaking = breakingOnly(posts);
  log('scrape.done', { total: posts.length, breaking: breaking.length });

  // First run: mark the whole backlog as seen and post nothing, so a fresh
  // install never floods the story feed with old news.
  if (!state.initialized) {
    for (const p of posts) markSeen(state, p.id);
    state.initialized = true;
    saveState(state);
    log('state.initialized', { seeded: posts.length });
    return;
  }

  const candidates = breaking.filter((p) => !state.seenIds.includes(p.id) && isFresh(p));
  if (candidates.length === 0) {
    log('run.nothing_new');
    return;
  }

  const gap = minutesSinceLastPost(state);
  if (gap < config.minMinutesBetweenPosts) {
    log('run.rate_capped', { minutesSinceLastPost: Math.round(gap), pending: candidates.length });
    return;
  }

  const post = candidates[0]; // newest first
  log('pipeline.start', { id: post.id, text: post.text });

  const analysis = await analyzePost(post.text);
  if (analysis.refused) {
    // Safety classifiers declined this item — skip it permanently and move on.
    markSeen(state, post.id);
    saveState(state);
    log('pipeline.skipped_refusal', { id: post.id });
    return;
  }
  log('analyze.done', {
    arabic: analysis.arabic_text,
    category: analysis.category,
    people: analysis.people?.map((p) => p.value),
    personPhotoUnsafe: analysis.person_photo_unsafe,
    entities: analysis.entities?.map((e) => e.wikimedia_query),
  });

  const background = await pickBackground(analysis);
  const pngPath = await renderStory({
    arabicText: analysis.arabic_text,
    category: analysis.category,
    background,
  });

  if (config.dryRun) {
    fs.mkdirSync(config.outDir, { recursive: true });
    const outPath = path.join(config.outDir, `${post.id}.png`);
    fs.copyFileSync(pngPath, outPath);
    markSeen(state, post.id);
    saveState(state);
    log('pipeline.dry_run_done', { id: post.id, saved: outPath });
    return;
  }

  const imageUrl = await hostImage(pngPath, `${post.id}.png`);
  const results = await postStory(imageUrl, { headline: analysis.arabic_text });
  markSeen(state, post.id);
  state.lastPostedAt = new Date().toISOString();
  saveState(state);
  log('pipeline.posted', {
    id: post.id,
    surfaces: results.filter((r) => r.ok).map((r) => r.surface),
    failed: results.filter((r) => !r.ok).map((r) => r.surface),
  });
}

main().catch((err) => {
  log('run.error', { error: String(err.stack || err) });
  process.exit(1);
});
