import fs from 'node:fs';
import { config } from './config.js';

const MAX_SEEN = 1000;

export function loadState() {
  try {
    return JSON.parse(fs.readFileSync(config.statePath, 'utf8'));
  } catch {
    return { initialized: false, seenIds: [], lastPostedAt: null };
  }
}

export function saveState(state) {
  if (state.seenIds.length > MAX_SEEN) {
    state.seenIds = state.seenIds.slice(-MAX_SEEN);
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
