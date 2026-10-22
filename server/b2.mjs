import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const b2Prefix = 'b2:';
export const freeStorageBytes = 10_000_000_000;
const problem = (message, status = 503) => Object.assign(new Error(message), { status, publicMessage: message });
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,300}$/.test(value);
// Only provider-issued HTTPS hosts can receive account/upload credentials.
function providerUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.backblazeb2.com') || url.username || url.password || url.port || url.hash) throw problem('Backblaze returned an invalid storage address.');
  return url;
}

export class BackblazeStorage {
  constructor({ keyId = process.env.B2_KEY_ID, applicationKey = process.env.B2_APPLICATION_KEY, bucketId = process.env.B2_BUCKET_ID, fetcher = fetch } = {}) {
    this.keyId = keyId; this.applicationKey = applicationKey; this.bucketId = bucketId; this.fetch = fetcher;
    this.configured = Boolean(keyId && applicationKey && validId(bucketId));
  }
  async authorize(force = false) {
    if (!this.configured) throw problem('Video storage is not connected. Add the Backblaze B2 settings in Render.');
    if (!force && this.account && this.expires > Date.now()) return this.account;
    if (!this.authorizing) this.authorizing = (async () => {
      const response = await this.fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
        headers: { Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.applicationKey}`).toString('base64')}` },
        signal: AbortSignal.timeout(20000), redirect: 'error',
      });
      if (!response.ok) { await response.body?.cancel(); throw problem('Backblaze authorization failed. Check the application key in Render.'); }
      const result = await response.json(), storage = result.apiInfo?.storageApi;
      const value = { accountId: result.accountId, authorizationToken: result.authorizationToken, ...storage };
      providerUrl(value.apiUrl); providerUrl(value.downloadUrl);
      if (!value.authorizationToken || !validId(value.accountId) || value.allowed?.buckets?.length !== 1 || value.allowed.buckets[0]?.id !== this.bucketId || value.allowed?.namePrefix || !['listBuckets', 'listFiles', 'readFiles', 'writeFiles', 'deleteFiles'].every(cap => value.allowed?.capabilities?.includes(cap))) throw problem('Use a read-and-write Backblaze application key restricted to the selected bucket, without a filename prefix.');
      this.account = value; this.expires = Date.now() + 23 * 3600000;
      return value;
    })().finally(() => { this.authorizing = null; });
    return this.authorizing;
  }
  async call(method, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const account = await this.authorize(attempt === 1);
      const response = await this.fetch(new URL(`/b2api/v2/${method}`, account.apiUrl), {
        method: 'POST', headers: { Authorization: account.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error',
      });
      if (response.status === 401 && attempt === 0) { await response.body?.cancel(); continue; }
      if (!response.ok) { await response.body?.cancel(); throw problem('Video storage is unavailable. Check the Backblaze key, permissions, and free usage caps.'); }
      return response.json();
    }
  }
  async inspect() {
    const { accountId } = await this.authorize();
    const { buckets } = await this.call('b2_list_buckets', { accountId, bucketId: this.bucketId });
    if (!buckets?.some(bucket => bucket.bucketId === this.bucketId && bucket.bucketType === 'allPrivate')) throw problem('Set the Backblaze review bucket to Private before uploading.');
    let usedBytes = 0, startFileName, startFileId;
    const seen = new Set();
    do {
      const page = await this.call('b2_list_file_versions', { bucketId: this.bucketId, maxFileCount: 1000, ...(startFileName ? { startFileName, startFileId } : {}) });
      if (!Array.isArray(page.files)) throw problem('Unable to check the video storage allowance.');
      for (const file of page.files) {
        const size = Number(file.contentLength);
        if (!Number.isSafeInteger(size) || size < 0) throw problem('Unable to check the video storage allowance.');
        usedBytes += size;
      }
      startFileName = page.nextFileName; startFileId = page.nextFileId;
      if (startFileName) {
        const cursor = JSON.stringify([startFileName, startFileId]);
        if (seen.has(cursor)) throw problem('Unable to check the video storage allowance.');
        seen.add(cursor);
      }
    } while (startFileName);
    return { usedBytes, maxBytes: freeStorageBytes };
  }
  async status() {
    if (!this.configured) return { provider: 'backblaze', configured: false, connected: false, maxBytes: freeStorageBytes };
    try { return { provider: 'backblaze', configured: true, connected: true, ...await this.inspect() }; }
    catch (error) { return { provider: 'backblaze', configured: true, connected: false, maxBytes: freeStorageBytes, message: error.publicMessage || 'Video storage could not be reached. Try again.' }; }
  }
  async upload(filename, name, type, size) {
    // Serialize quota checks and writes within this service. Account-wide zero-dollar
    // caps must also be set in Backblaze; this guard covers this dedicated bucket.
    const previous = this.uploading || Promise.resolve();
    let release; this.uploading = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const { usedBytes } = await this.inspect();
      if (usedBytes + size > freeStorageBytes) throw problem('The 10 GB video storage limit is reached. Remove unused files in Backblaze before uploading more.', 413);
      const sha1 = createHash('sha1');
      for await (const chunk of createReadStream(filename)) sha1.update(chunk);
      const checksum = sha1.digest('hex');
      for (let attempt = 0; attempt < 2; attempt++) {
        const session = await this.call('b2_get_upload_url', { bucketId: this.bucketId });
        const url = providerUrl(session.uploadUrl);
        const response = await this.fetch(url, {
          method: 'POST', headers: { Authorization: session.authorizationToken, 'Content-Type': type, 'Content-Length': String(size), 'X-Bz-File-Name': encodeURIComponent(name), 'X-Bz-Content-Sha1': checksum },
          body: createReadStream(filename), duplex: 'half', signal: AbortSignal.timeout(180000), redirect: 'error',
        });
        if (response.status === 401 && attempt === 0) { await response.body?.cancel(); continue; }
        if (!response.ok) { await response.body?.cancel(); throw problem('Video upload stopped. Check the free storage and download caps in Backblaze.'); }
        const value = await response.json();
        if (!validId(value.fileId) || value.fileName !== name || value.bucketId !== this.bucketId || Number(value.contentLength) !== size || value.contentSha1 !== checksum) throw problem('Backblaze did not confirm the uploaded video.');
        return `${b2Prefix}${value.fileId}:${Buffer.from(name).toString('base64url')}`;
      }
    } finally { release(); }
  }
  reference(value) {
    if (typeof value !== 'string' || !value.startsWith(b2Prefix)) throw problem('Invalid stored video reference.');
    const [fileId, encodedName] = value.slice(b2Prefix.length).split(':');
    const fileName = Buffer.from(encodedName || '', 'base64url').toString();
    if (!validId(fileId) || !fileName.startsWith('pvr/')) throw problem('Invalid stored video reference.');
    return { fileId, fileName };
  }
  async media(reference, { range, signal } = {}) {
    const { fileId } = this.reference(reference);
    for (let attempt = 0; attempt < 2; attempt++) {
      const account = await this.authorize(attempt === 1);
      const url = new URL('/b2api/v2/b2_download_file_by_id', account.downloadUrl); url.searchParams.set('fileId', fileId);
      const response = await this.fetch(url, { headers: { Authorization: account.authorizationToken, ...(range ? { Range: range } : {}) }, signal, redirect: 'error' });
      if (response.status === 401 && attempt === 0) { await response.body?.cancel(); continue; }
      return response;
    }
  }
  async remove(reference) { return this.call('b2_delete_file_version', this.reference(reference)); }
}
