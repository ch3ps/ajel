import fs from 'node:fs';
import { config, log } from './config.js';

// Ayrshare's media upload is a paid-plan endpoint, so the rendered story is
// hosted in Azure Blob instead.
//
// Two container-scoped SAS tokens are used rather than the storage account key:
// a write token that stays secret (upload only) and a read token that rides in
// the URL handed to Snapchat. Neither can touch anything outside this container,
// both expire, and the account key never leaves the developer's machine. Plain
// REST keeps it dependency-free so the same code runs locally and in CI.

const ATTEMPTS = 3;

// undici reports connection-level problems as a bare "fetch failed" TypeError
// and hides the real reason on .cause — unwrap it or CI logs tell you nothing.
function describe(err) {
  const cause = err?.cause;
  if (!cause) return String(err?.message || err);
  return `${err.message} (cause: ${cause.code || ''} ${cause.message || cause})`.trim();
}

export async function hostImage(localPath, blobName) {
  const { azureStorageAccount: account, azureContainer: container, azureWriteSas, azureReadSas } = config;
  if (!account) throw new Error('AZURE_STORAGE_ACCOUNT is not set');
  if (!azureWriteSas || !azureReadSas) {
    throw new Error('AZURE_WRITE_SAS / AZURE_READ_SAS are not set — needed to host the story image');
  }

  const base = `https://${account}.blob.core.windows.net/${container}/${encodeURIComponent(blobName)}`;
  const body = fs.readFileSync(localPath);

  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${base}?${azureWriteSas.replace(/^\?/, '').trim()}`, {
        method: 'PUT',
        // No manual Content-Length: undici derives it from the body, and a
        // hand-set value that disagrees aborts the request before it is sent.
        headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'image/png' },
        body,
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      return `${base}?${azureReadSas.replace(/^\?/, '').trim()}`;
    } catch (err) {
      lastError = err;
      log('media.upload_attempt_failed', { attempt, of: ATTEMPTS, error: describe(err) });
      if (attempt < ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt * 3000));
      }
    }
  }
  throw new Error(`Blob upload failed after ${ATTEMPTS} attempts: ${describe(lastError)}`);
}
