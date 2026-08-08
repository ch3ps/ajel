import fs from 'node:fs';
import { config } from './config.js';

const MAX_SEEN = 1000;

export function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(config.statePath, 'utf8'));
    state.failures ??= {};
    return state;
  } catch {
    return { initialized: false, seenIds: [], lastPostedAt: null, failures: {} };
  }
}

// A post that keeps failing must not be retried forever: it is always the
// newest candidate, so it would block every later story behind it.
export function recordFailure(state, id) {
  state.failures[id] = (state.failures[id] || 0) + 1;
  return state.failures[id];
}

export function clearFailure(state, id) {
  delete state.failures[id];
}

export function saveState(state) {
  if (state.seenIds.length > MAX_SEEN) {
    state.seenIds = state.seenIds.slice(-MAX_SEEN);
  }
  // Drop failure counters for items already dealt with, so the file cannot grow
  // without bound.
  for (const id of Object.keys(state.failures || {})) {
    if (state.seenIds.includes(id)) delete state.failures[id];
  }
  fs.writeFileSync(config.statePath, JSON.stringify(state, null, 2));
}

export function markSeen(state, id) {
  if (!state.seenIds.includes(id)) state.seenIds.push(id);
}

export function minutesSinceLastPost(state) {
  if (!state.lastPostedAt) return Infinity;
  return (Date.now() - new Date(state.lastPostedAt).getTime()) / 60000;
}
