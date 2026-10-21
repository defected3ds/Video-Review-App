import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer,root } from './helpers.mjs';

test('Site uploads and imports use Google Drive with private streaming',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pvr-drive-')),video=readFileSync(path.join(root,'public/demo.mp4'));
  const folder='configured-folder',source='source-video',uploaded='uploaded-video';
  let uploadedBytes,uploadMetadata,tokenRequests=0,mediaRequests=0,deletes=0,challenge,server,cookie='';
  const provider=createServer(async(req,res)=>{
    try {
      const target=new URL(req.headers['x-provider-url']),chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
      const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
      if(target.hostname==='oauth2.googleapis.com'){
        const form=new URLSearchParams(body.toString());assert.equal(form.get('client_id'),'test-client');assert.equal(form.get('client_secret'),'test-client-secret');
        if(form.get('grant_type')==='authorization_code')assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),challenge);
        else {assert.equal(form.get('grant_type'),'refresh_token');assert.equal(form.get('refresh_token'),'fake-refresh-token');}
        tokenRequests++;return json({access_token:'fake-access-token',refresh_token:'fake-refresh-token',expires_in:tokenRequests===1?1:3600,scope:'https://www.googleapis.com/auth/drive'});
      }
      assert.equal(req.headers.authorization,'Bearer fake-access-token');
      if(target.pathname==='/drive/v3/files'&&req.method==='GET'){
        assert.ok(target.searchParams.get('q').includes(`'${folder}' in parents`));return json({files:[{id:source,name:'Source clip.mp4',size:String(video.length),mimeType:'video/mp4',capabilities:{canDownload:true}}]});
      }
      if(target.pathname===`/drive/v3/files/${folder}`)return json({id:folder,mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}});
      if(target.pathname==='/upload/drive/v3/files'&&req.method==='POST'){
        uploadMetadata=JSON.parse(body);assert.deepEqual(uploadMetadata.parents,[folder]);
        res.writeHead(200,{location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=test'});return res.end();
      }
      if(target.pathname==='/upload/drive/v3/files'&&req.method==='PUT'){
        uploadedBytes=body;return json({id:uploaded,name:'Uploaded.mp4',size:String(body.length),mimeType:'video/mp4'});
      }
      const id=target.pathname.split('/').at(-1);
      if(req.method==='DELETE'){deletes++;res.writeHead(204);return res.end();}
      if(target.searchParams.get('alt')==='media'){
        mediaRequests++;assert.ok([source,uploaded].includes(id));
        const range=req.headers.range;
        if(range){const [,a,b]=range.match(/^bytes=(\d+)-(\d+)$/),start=Number(a),end=Number(b);res.writeHead(206,{'content-type':'video/mp4','content-range':`bytes ${start}-${end}/${video.length}`,'content-length':String(end-start+1)});return res.end(video.subarray(start,end+1));}
        res.writeHead(200,{'content-type':'video/mp4','content-length':String(video.length)});return res.end(video);
      }
      return json({id,name:'Source clip.mp4',size:String(id==='oversized-video'?251*1024*1024:video.length),mimeType:'video/mp4',parents:[id==='outside-folder'?'another-folder':folder],capabilities:{canDownload:true}});
    }catch(error){res.writeHead(500);res.end();console.error(error);}
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const env={GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-client-secret',GOOGLE_TOKEN_ENCRYPTION_KEY:'test-only-encryption-key-at-least-32-characters',GOOGLE_DRIVE_FOLDER_ID:folder,APP_URL:'http://127.0.0.1:4000',DRIVE_ALLOW_LOCAL_TEST:'1',MOCK_DRIVE_URL:`http://127.0.0.1:${provider.address().port}`,NODE_OPTIONS:`--import=${path.join(root,'tests/drive-fetch-preload.mjs')}`};
  const request=(route,method='GET',body,auth=true,headers={})=>fetch(server.base+route,{method,headers:{...(auth&&cookie?{cookie}:{}),...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,redirect:'manual'});
  let asset,invitation;
  try{
    server=await startServer(dir,env);
    await t.test('only the owner can connect, list, import, or upload',async()=>{
      assert.equal((await request('/api/drive/status','GET',null,false)).status,401);
      assert.equal((await request('/api/drive/connect','POST',null,false)).status,401);
      assert.equal((await request('/api/projects/launch/drive-import','POST',{fileId:source},false)).status,401);
      const setup=await request('/api/setup','POST',{name:'Owner',password:'a-test-password-123'});assert.equal(setup.status,201);cookie=setup.headers.get('set-cookie').split(';')[0];
    });
    await t.test('OAuth uses PKCE, consumes expiring state once, encrypts tokens, and refreshes access',async()=>{
      const value=await (await request('/api/drive/connect','POST')).json(),authUrl=new URL(value.url),state=authUrl.searchParams.get('state');
      challenge=authUrl.searchParams.get('code_challenge');assert.equal(authUrl.searchParams.get('code_challenge_method'),'S256');assert.equal(authUrl.searchParams.get('redirect_uri'),'http://127.0.0.1:4000/api/drive/callback');
      const callback=await request(`/api/drive/callback?state=${state}&code=valid-code`);assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/?drive=connected');
      assert.equal((await request(`/api/drive/callback?state=${state}&code=valid-code`)).headers.get('location'),'/?drive=error');assert.equal(tokenRequests,1);
      const files=await (await request('/api/drive/files')).json();assert.equal(files.files[0].id,source);assert.equal(tokenRequests,2);
      const db=new DatabaseSync(path.join(dir,'review.sqlite'));const saved=db.prepare('SELECT payload FROM connections WHERE id=?').get('google-drive');db.close();assert.ok(saved.payload);assert.ok(!saved.payload.includes('fake-refresh-token'));
      const status=await (await request('/api/drive/status')).json();assert.equal(status.connected,true);assert.ok(!JSON.stringify(status).includes('token'));
    });
    await t.test('site upload sends real video bytes into the chosen Drive folder and clears temporary copies',async()=>{
      const form=new FormData();form.append('video',new Blob([video],{type:'video/mp4'}),'Uploaded.mp4');
      const response=await request('/api/projects/launch/assets','POST',form);assert.equal(response.status,201);asset=await response.json();
      assert.equal(uploadMetadata.name,'Uploaded.mp4');assert.deepEqual(uploadedBytes,video);assert.equal(asset.duration,8);assert.equal(asset.fps,25);assert.equal(asset.demo,false);assert.equal(asset.inDrive,true);assert.equal(asset.filename,undefined);
      assert.deepEqual(readdirSync(path.join(dir,'uploads')),[]);
      const poster=await request(`/api/assets/${asset.id}/poster`);assert.equal(poster.status,200);assert.match(poster.headers.get('content-type'),/image\/jpeg/);
    });
    await t.test('authorized playback preserves byte ranges; guests never receive Google tokens',async()=>{
      invitation=await (await request(`/api/assets/${asset.id}/share`,'POST')).json();
      const response=await request(`/api/reviews/${invitation.token}/video`,'GET',null,false,{Range:'bytes=0-99'});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),video.subarray(0,100));assert.match(response.headers.get('content-range'),/^bytes 0-99\//);
      assert.ok(!response.headers.get('authorization'));assert.equal((await request('/api/drive/files','GET',null,false)).status,401);
      assert.equal((await request(`/api/reviews/${invitation.token}/comments`,'POST',{author:'Client',body:'Please check this frame.',time:2,hotspot:{x:.4,y:.5}},false)).status,201);
      assert.equal((await request(`/api/assets/${asset.id}/video`,'GET',null,true,{Range:'garbage'})).status,416);
    });
    await t.test('import validates folder and size, inspects metadata, and stores a durable thumbnail',async()=>{
      const count=mediaRequests;
      assert.equal((await request('/api/projects/launch/drive-import','POST',{fileId:'outside-folder'})).status,403);
      assert.equal((await request('/api/projects/launch/drive-import','POST',{fileId:'oversized-video'})).status,400);assert.equal(mediaRequests,count);
      const response=await request('/api/projects/launch/drive-import','POST',{fileId:source});assert.equal(response.status,201);const imported=await response.json();assert.equal(imported.fps,25);assert.equal(imported.duration,8);assert.equal(imported.demo,false);
      assert.deepEqual(readdirSync(path.join(dir,'uploads')),[]);
    });
    await t.test('restart retains the connection and source media; disconnect stops playback',async()=>{
      await server.stop();server=await startServer(dir,env);
      assert.equal((await request(`/api/reviews/${invitation.token}/video`,'GET',null,false,{Range:'bytes=0-99'})).status,206);
      assert.equal((await request('/api/drive/connect','DELETE')).status,204);
      assert.equal((await (await request('/api/drive/status')).json()).connected,false);
      assert.equal((await request(`/api/reviews/${invitation.token}/video`,'GET',null,false)).status,401);
      assert.equal((await request('/api/projects/launch','DELETE')).status,204);assert.equal(deletes,0,'Deleting a project must preserve Drive originals.');
      assert.equal((await request(`/api/reviews/${invitation.token}`,'GET',null,false)).status,404);
    });
  }finally{if(server)await server.stop();await new Promise(resolve=>provider.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
