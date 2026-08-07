import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

export const config = {
  // Safety default: live posting requires an explicit DRY_RUN=0 in .env
  dryRun: process.env.DRY_RUN !== '0',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  // Ayrshare posts to Snapchat; its own media upload is paid-plan only, so the
  // rendered image is hosted in a private Azure container via short-lived SAS.
  ayrshareApiKey: process.env.AYRSHARE_API_KEY,
  azureStorageAccount: process.env.AZURE_STORAGE_ACCOUNT,
  azureContainer: process.env.AZURE_CONTAINER || 'ajel-media',
  azureWriteSas: process.env.AZURE_WRITE_SAS,
  azureReadSas: process.env.AZURE_READ_SAS,

  sourceUrl: 'https://www.thespectatorindex.com/',
  minMinutesBetweenPosts: Number(process.env.MIN_MINUTES_BETWEEN_POSTS || 20),
  maxItemAgeHours: Number(process.env.MAX_ITEM_AGE_HOURS || 6),

  workDir: path.join(ROOT, 'work'),
  outDir: path.join(ROOT, 'out'),
  templatePath: path.join(ROOT, 'template', 'story.html'),
  statePath: path.join(ROOT, 'state.json'),
};

export function log(event, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...extra }));
}
