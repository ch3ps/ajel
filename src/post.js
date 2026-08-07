import fs from 'node:fs';
import { config, log } from './config.js';

const BASE = 'https://api.ayrshare.com/api';

async function ayrshare(method, path, { json, form } = {}) {
  const headers = { Authorization: `Bearer ${config.ayrshareApiKey}` };
  if (json) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: json ? JSON.stringify(json) : form,
    // Snapchat publishing regularly takes 60-90s server-side; give it room so a
    // slow-but-successful post isn't recorded as a failure.
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(`Ayrshare ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 600)}`);
  }
  return parsed;
}

// Which Snapchat surfaces the connected account can post to.
export async function getAccountInfo() {
  return ayrshare('GET', '/user');
}

// Ayrshare hosts the media for us, so no external bucket is involved.
export async function uploadMedia(localPath, fileName) {
  const form = new FormData();
  const bytes = fs.readFileSync(localPath);
  form.append('file', new Blob([bytes], { type: 'image/png' }), fileName);
  form.append('fileName', fileName);
  const data = await ayrshare('POST', '/media/upload', { form });
  const url = data.url || data.mediaUrl || data.id;
  if (!url) throw new Error(`Ayrshare upload returned no URL: ${JSON.stringify(data).slice(0, 300)}`);
  return url;
}

// Snapchat treats these as different post types and Ayrshare has no combined
// option, so each surface is its own API call (and its own quota unit):
//   savedStory:true → Public Profile, permanent, visible to non-subscribers
//   no options      → personal 24h story shown to friends
// Ayrshare rejects posts whose text closely matches another post from the last
// two days, so the two surfaces must carry visibly different captions — and the
// captions must vary per story, or consecutive posts collide with each other.
const SURFACES = [
  {
    name: 'publicProfile',
    options: { savedStory: true },
    caption: (headline) => headline,
  },
  {
    name: 'personalStory',
    options: {},
    caption: (headline) => `${headline}\n\nتابعوا التغطية الكاملة على حسابنا @aldoha.news`,
  },
];

async function postToSurface(imageUrl, headline, surface) {
  const body = {
    post: surface.caption(headline),
    platforms: ['snapchat'],
    mediaUrls: [imageUrl],
    ...(Object.keys(surface.options).length ? { snapChatOptions: surface.options } : {}),
  };
  const data = await ayrshare('POST', '/post', { json: body });
  const snap = (data.postIds || []).find((p) => p.platform === 'snapchat');
  if (data.status && data.status !== 'success') {
    throw new Error(`status=${data.status} ${JSON.stringify(data).slice(0, 400)}`);
  }
  return { id: data.id, type: snap?.type, postUrl: snap?.postUrl };
}

// Publishes the same image to both surfaces. One surface failing does not
// discard the other — a story that reached the profile but not the friends feed
// is still published, and the caller records it as posted.
export async function postStory(imageUrl, { headline = '' } = {}) {
  if (!config.ayrshareApiKey) {
    throw new Error('AYRSHARE_API_KEY is not set — add it to .env');
  }

  const results = [];
  for (const surface of SURFACES) {
    try {
      const result = await postToSurface(imageUrl, headline, surface);
      log('post.surface_ok', { surface: surface.name, type: result.type, postUrl: result.postUrl });
      results.push({ surface: surface.name, ok: true, ...result });
    } catch (err) {
      log('post.surface_failed', { surface: surface.name, error: String(err).slice(0, 400) });
      results.push({ surface: surface.name, ok: false, error: String(err) });
    }
  }

  if (!results.some((r) => r.ok)) {
    throw new Error(`Snapchat post failed on every surface: ${JSON.stringify(results).slice(0, 600)}`);
  }
  return results;
}
