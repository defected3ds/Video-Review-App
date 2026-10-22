import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BackblazeStorage, freeStorageBytes } from '../server/b2.mjs';
import { startServer, root } from './helpers.mjs';

test('Backblaze uploads, free limits, and private owner/guest playback', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pvr-b2-')), video = readFileSync(path.join(root, 'public/demo.mp4'));
  const files = new Map(), bucketId = 'test-bucket';
  let bucketType = 'allPrivate', extraBytes = 0, serial = 0, authorizations = 0, accountToken, expiredMedia = false, downloadCap = false, server, cookie = '', deleteDuringUpload;
  const provider = createServer(async (req, res) => {
    try {
      const url = new URL(req.headers['x-provider-url']), chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (url.pathname.endsWith('b2_authorize_account')) {
        assert.equal(req.headers.authorization, `Basic ${Buffer.from('test-key-id:test-key-secret').toString('base64')}`);
        accountToken = `test-account-token-${++authorizations}`;
        assert.equal(url.pathname, '/b2api/v4/b2_authorize_account');
        return json({ accountId: 'test-account', authorizationToken: accountToken, apiInfo: { storageApi: { apiUrl: 'https://api001.backblazeb2.com', downloadUrl: 'https://f001.backblazeb2.com', allowed: { buckets: [{ id: bucketId, name: 'review-videos' }], namePrefix: null, capabilities: ['listBuckets', 'listFiles', 'readFiles', 'writeFiles', 'deleteFiles'] } } } });
      }
      if (url.pathname.includes('/b2_upload_file/')) {
        assert.equal(url.hostname, 'pod-031-2032-06.backblaze.com');
        assert.equal(req.headers.authorization, 'test-upload-token'); assert.ok(bytes.length>0);assert.ok(bytes.length<=video.length);
        assert.equal(req.headers['x-bz-content-sha1'], createHash('sha1').update(bytes).digest('hex'));
        const fileName = decodeURIComponent(req.headers['x-bz-file-name']); assert.match(fileName, /^pvr\/[^/]+\/[^/]+\.mp4$/);
        const file = { fileId: `uploaded-${++serial}`, fileName, bucketId, contentLength: bytes.length, contentSha1: req.headers['x-bz-content-sha1'] };
        Object.defineProperty(file,'bytes',{value:bytes});files.set(file.fileId, file);
        if (deleteDuringUpload) { await request(`/api/projects/${deleteDuringUpload}`, 'DELETE'); deleteDuringUpload = undefined; }
        return json(file);
      }
      assert.equal(req.headers.authorization, accountToken);
      if (url.pathname.endsWith('b2_list_buckets')) return json({ buckets: [{ bucketId, bucketType }] });
      if (url.pathname.endsWith('b2_list_file_versions')) return json({ files: [...files.values(), { contentLength: extraBytes }], nextFileName: null, nextFileId: null });
      if (url.pathname.endsWith('b2_get_upload_url')) return json({ bucketId, authorizationToken: 'test-upload-token', uploadUrl: 'https://pod-031-2032-06.backblaze.com/b2api/v2/b2_upload_file/bucket/session' });
      if (url.pathname.endsWith('b2_delete_file_version')) {
        const value = JSON.parse(bytes); assert.equal(value.fileName, files.get(value.fileId).fileName); files.delete(value.fileId); return json(value);
      }
      if (url.pathname.endsWith('b2_download_file_by_id')) {
        if(downloadCap)return json({code:'cap_exceeded',message:'Download bandwidth cap exceeded'},403);
        if (expiredMedia) { expiredMedia = false; return json({ code: 'expired_auth_token' }, 401); }
        assert.ok(files.has(url.searchParams.get('fileId')));
        const stored=files.get(url.searchParams.get('fileId')).bytes;
        if (req.headers.range) {
          const [, a, b] = req.headers.range.match(/^bytes=(\d+)-(\d+)$/), start = Number(a), end = Number(b);
          res.writeHead(206, { 'content-type': 'video/mp4', 'content-range': `bytes ${start}-${end}/${stored.length}`, 'content-length': String(end - start + 1) }); return res.end(stored.subarray(start, end + 1));
        }
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(stored.length) }); return res.end(stored);
      }
      throw new Error(`Unexpected Backblaze method ${url.pathname}`);
    } catch (error) { console.error(error); res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const env = { B2_KEY_ID: 'test-key-id', B2_APPLICATION_KEY: 'test-key-secret', B2_BUCKET_ID: bucketId, MOCK_B2_URL: `http://127.0.0.1:${provider.address().port}`, NODE_OPTIONS: `--import=${path.join(root, 'tests/b2-fetch-preload.mjs')}` };
  const request = (route, method = 'GET', body, auth = true, headers = {}) => fetch(server.base + route, { method, headers: { ...(auth && cookie ? { cookie } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const upload = project => { const form = new FormData(); form.append('video', new Blob([video], { type: 'video/mp4' }), 'Review.mp4'); return request(`/api/projects/${project}/assets`, 'POST', form); };
  let asset, invitation, storedVideo;
  try {
    server = await startServer(dir, env);
    await t.test('owner-only status and private bucket validation', async () => {
      assert.equal((await request('/api/storage/status', 'GET', null, false)).status, 401);
      const setup = await request('/api/setup', 'POST', { name: 'Owner', password: 'review' }); assert.equal(setup.status, 201); cookie = setup.headers.get('set-cookie').split(';')[0];
      bucketType = 'allPublic';
      assert.equal((await (await request('/api/storage/status')).json()).connected, false);
      assert.equal((await upload('launch')).status, 503); assert.equal(files.size, 0); assert.deepEqual(readdirSync(path.join(dir, 'uploads')), []);
      bucketType = 'allPrivate';
      const status = await (await request('/api/storage/status')).json(); assert.equal(status.connected, true); assert.equal(status.maxBytes, freeStorageBytes);
      assert.ok(!JSON.stringify(status).includes('test-key')); assert.ok(!JSON.stringify(status).includes('token'));
    });
    await t.test('validated video bytes and checksum reach storage; temporary files are removed', async () => {
      const response = await upload('launch'); assert.equal(response.status, 201); asset = await response.json();storedVideo=[...files.values()].at(-1).bytes;assert.equal(asset.reviewCopy,false);assert.deepEqual(storedVideo,video);assert.equal(asset.size,storedVideo.length);
      assert.equal(asset.inB2, true); assert.equal(asset.inDrive, false); assert.equal(asset.filename, undefined); assert.equal(asset.duration, 8); assert.equal(asset.fps, 25);
      assert.deepEqual(readdirSync(path.join(dir, 'uploads')), []);
      const poster = await request(`/api/assets/${asset.id}/poster`); assert.equal(poster.status, 200); assert.match(poster.headers.get('content-type'), /image\/jpeg/);
    });
    await t.test('10 GB guard counts retained versions before uploading and cleans rejected temporary files', async () => {
      const count = serial; extraBytes = freeStorageBytes - [...files.values()].reduce((sum,file)=>sum+file.contentLength,0);
      assert.equal((await upload('launch')).status, 413); assert.equal(serial, count); extraBytes = 0;
      assert.deepEqual(readdirSync(path.join(dir, 'uploads')), []);
    });
    await t.test('private range playback, token refresh, scoped guest feedback, and revocation', async () => {
      assert.equal((await request(`/api/assets/${asset.id}/video`, 'GET', null, false)).status, 401);
      invitation = await (await request(`/api/assets/${asset.id}/share`, 'POST')).json(); expiredMedia = true;
      const before = authorizations;
      const response = await request(`/api/reviews/${invitation.token}/video`, 'GET', null, false, { Range: 'bytes=10-99' });
      assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), `bytes 10-99/${storedVideo.length}`); assert.deepEqual(Buffer.from(await response.arrayBuffer()), storedVideo.subarray(10, 100)); assert.equal(authorizations, before + 1); assert.equal(response.headers.get('authorization'), null);
      assert.equal((await request(`/api/reviews/${invitation.token}/comments`, 'POST', { author: 'Client', body: 'Check this frame', time: 2, hotspot: { x: .3, y: .5 }, annotations: [{ color: '#00358e', points: [{ x: .1, y: .2 }, { x: .2, y: .3 }] }] }, false)).status, 201);
      assert.equal((await request(`/api/assets/${asset.id}/video`, 'GET', null, true, { Range: 'garbage' })).status, 416);
      assert.equal((await request(`/api/projects/launch/assets`, 'POST', null, false)).status, 401);
    });
    await t.test('download caps explain playback failure without affecting feedback or leaking credentials', async () => {
      downloadCap=true;
      const response=await request(`/api/reviews/${invitation.token}/video`,'GET',null,false,{Range:'bytes=0-1'});assert.equal(response.status,503);assert.match((await response.json()).error,/daily download cap/);
      const issue=await (await request(`/api/reviews/${invitation.token}/playback-status`,'GET',null,false)).json();assert.equal(issue.available,false);assert.equal(issue.code,'download_cap_reached');assert.match(issue.message,/comments and drawings are still available/);
      assert.equal((await request(`/api/assets/${asset.id}/playback-status`,'GET',null,false)).status,401);
      assert.equal((await request(`/api/reviews/${invitation.token}/comments`,'GET',null,false)).status,200);
      const storage=await (await request('/api/storage/status')).json();assert.equal(storage.connected,true);assert.match(storage.playbackWarning,/daily bandwidth cap/);
      downloadCap=false;
      const recovered=await request(`/api/assets/${asset.id}/video`,'GET',null,true,{Range:'bytes=0-1'});assert.equal(recovered.status,206);await recovered.arrayBuffer();
      assert.equal((await (await request(`/api/assets/${asset.id}/playback-status`)).json()).available,true);
      assert.equal((await (await request('/api/storage/status')).json()).playbackWarning,null);
    });
    await t.test('existing source compression preserves scoped links, timing, feedback and originals', async () => {
      assert.equal((await request(`/api/assets/${asset.id}/optimize`,'POST',null,false)).status,401);
      assert.equal((await request(`/api/reviews/${invitation.token}/optimize`,'POST',null,false)).status,404);
      const db=new DatabaseSync(path.join(dir,'review.sqlite')),legacy=[...files.values()][0];legacy.fileName=legacy.fileName.replace('-review.mp4','.mp4');
      db.prepare('UPDATE assets SET filename=? WHERE id=?').run(`b2:${legacy.fileId}:${Buffer.from(legacy.fileName).toString('base64url')}`,asset.id);db.close();
      const count=files.size;downloadCap=true;
      const capped=await request(`/api/assets/${asset.id}/optimize`,'POST');assert.equal(capped.status,503);assert.equal(files.size,count);assert.deepEqual(readdirSync(path.join(dir,'uploads')),[]);
      downloadCap=false;
      const result=await request(`/api/assets/${asset.id}/optimize`,'POST');assert.equal(result.status,200);const value=await result.json();assert.equal(value.asset.id,asset.id);assert.equal(value.asset.reviewCopy,true);assert.equal(value.asset.fps,25);assert.equal(value.asset.duration,8);assert.equal(files.size,count+1);assert.ok(files.has(legacy.fileId));
      storedVideo=[...files.values()].at(-1).bytes;
      const shared=await (await request(`/api/reviews/${invitation.token}`,'GET',null,false)).json();assert.equal(shared.asset.id,asset.id);assert.equal(shared.asset.size,storedVideo.length);
      const comments=await (await request(`/api/reviews/${invitation.token}/comments`,'GET',null,false)).json();assert.ok(comments.some(comment=>comment.body==='Check this frame'&&comment.time===2&&comment.annotations.length));
      const again=await (await request(`/api/assets/${asset.id}/optimize`,'POST')).json();assert.equal(again.alreadyOptimized,true);assert.equal(files.size,count+1);assert.deepEqual(readdirSync(path.join(dir,'uploads')),[]);
    });
    await t.test('restart preserves playback/feedback and deletion preserves cloud originals as disclosed', async () => {
      await server.stop(); server = await startServer(dir, env);
      const playback = await request(`/api/reviews/${invitation.token}/video`, 'GET', null, false); assert.equal(playback.status, 200); assert.deepEqual(Buffer.from(await playback.arrayBuffer()), storedVideo);
      const comments = await (await request(`/api/reviews/${invitation.token}/comments`, 'GET', null, false)).json(); assert.ok(comments.some(comment => comment.body === 'Check this frame' && comment.hotspot.x === .3));
      assert.equal((await request(`/api/assets/${asset.id}/share`, 'DELETE')).status, 204);
      assert.equal((await request(`/api/reviews/${invitation.token}/video`, 'GET', null, false)).status, 404);
      const count = files.size; assert.equal((await request('/api/projects/launch', 'DELETE')).status, 204); assert.equal(files.size, count);
    });
    await t.test('failed database save rolls back only the new cloud upload', async () => {
      const project = await (await request('/api/projects', 'POST', { name: 'Rollback fixture' })).json(); deleteDuringUpload = project.id;
      const count = files.size; assert.equal((await upload(project.id)).status, 500); assert.equal(files.size, count);
      assert.deepEqual(readdirSync(path.join(dir, 'uploads')), []);
    });
  } finally { if (server) await server.stop(); await new Promise(resolve => provider.close(resolve)); rmSync(dir, { recursive: true, force: true }); }
});

test('Backblaze rejects untrusted provider hosts and keys outside the private dedicated bucket', async () => {
  const valid = { apiUrl: 'https://api001.backblazeb2.com', downloadUrl: 'https://f001.backblazeb2.com', allowed: { buckets: [{ id: 'bucket' }], capabilities: ['listBuckets', 'listFiles', 'readFiles', 'writeFiles', 'deleteFiles'] } };
  for (const overrides of [{ apiUrl: 'https://attacker.example' }, { downloadUrl: 'http://f001.backblazeb2.com' }, { allowed: { ...valid.allowed, buckets: null } }, { allowed: { ...valid.allowed, buckets: [{ id: 'bucket' }, { id: 'another-bucket' }] } }, { allowed: { ...valid.allowed, namePrefix: 'some-prefix/' } }, { allowed: { ...valid.allowed, capabilities: ['writeFiles'] } }]) {
    const storage = new BackblazeStorage({ keyId: 'key', applicationKey: 'secret', bucketId: 'bucket', fetcher: async () => Response.json({ accountId: 'account', authorizationToken: 'token', apiInfo: { storageApi: { ...valid, ...overrides } } }) });
    await assert.rejects(storage.authorize());
  }
  const unconfigured = new BackblazeStorage({ keyId: '', applicationKey: '', bucketId: '' });
  assert.equal((await unconfigured.status()).configured, false);
});

test('Upload sessions reject non-HTTPS pods and lookalike domains before sending credentials', async () => {
  for (const uploadUrl of ['http://pod-031-2032-06.backblaze.com/b2api/v2/b2_upload_file', 'https://pod-031-2032-06.backblaze.com.attacker.example/upload', 'https://www.backblaze.com/upload', 'https://pod-031-2032-06.backblaze.com:8443/upload', 'https://user:secret@pod-031-2032-06.backblaze.com/upload']) {
    const storage = new BackblazeStorage({ fetcher: async () => { assert.fail('Untrusted upload destination must never receive credentials.'); } });
    storage.inspect = async () => ({ usedBytes: 0 });
    storage.call = async () => ({ uploadUrl, authorizationToken: 'test-only-upload-token' });
    await assert.rejects(storage.upload(path.join(root, 'public/demo.mp4'), 'pvr/test/sample.mp4', 'video/mp4', 42349), /invalid storage address/);
  }
});
