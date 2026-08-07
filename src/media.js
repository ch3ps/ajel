import fs from 'node:fs';
import { config } from './config.js';

// Ayrshare's media upload is a paid-plan endpoint, so the rendered story is
// hosted in Azure Blob instead.
//
// Two container-scoped SAS tokens are used rather than the storage account key:
// a write token that stays secret (upload only) and a read token that rides in
// the URL handed to Snapchat. Neither can touch anything outside this container,
// both expire, and the account key never leaves this machine. Plain REST keeps
// it dependency-free so the same code runs locally and in CI.
export async function hostImage(localPath, blobName) {
  const { azureStorageAccount: account, azureContainer: container, azureWriteSas, azureReadSas } = config;
  if (!account) throw new Error('AZURE_STORAGE_ACCOUNT is not set');
  if (!azureWriteSas || !azureReadSas) {
    throw new Error('AZURE_WRITE_SAS / AZURE_READ_SAS are not set — needed to host the story image');
  }

  const base = `https://${account}.blob.core.windows.net/${container}/${encodeURIComponent(blobName)}`;
  const body = fs.readFileSync(localPath);

  const res = await fetch(`${base}?${azureWriteSas}`, {
    method: 'PUT',
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'Content-Type': 'image/png',
      'Content-Length': String(body.length),
    },
    body,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    throw new Error(`Blob upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  return `${base}?${azureReadSas}`;
}
