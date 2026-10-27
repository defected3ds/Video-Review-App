import test from 'node:test';import assert from 'node:assert/strict';import{mkdtempSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import path from'node:path';import{DatabaseSync}from'node:sqlite';import{startServer,root}from'./helpers.mjs';

test('Temporary public access opens review workflows without granting admin sessions and can be switched off without changing data',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'pvr-public-'));let server=await startServer(dir,{WORKSPACE_PASSWORD_REQUIRED:'false'});
 const request=(route,method='GET',body,options={})=>fetch(server.base+route,{method,headers:body&&!(body instanceof FormData)?{'content-type':'application/json'}:{},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,...options});
 try{
  const setup=await request('/api/setup','POST',{name:'Owner',password:'review'}),ownerCookie=setup.headers.get('set-cookie').split(';')[0];assert.equal(setup.status,201);
  const session=await request('/api/session'),state=await session.json();assert.equal(state.authenticated,true);assert.equal(state.publicAccess,true);assert.equal(state.ownerAuthenticated,false);assert.equal(state.expiresAt,null);assert.equal(session.headers.get('set-cookie'),null);
  const admin=await(await request('/api/session?admin=1')).json();assert.equal(admin.authenticated,false);assert.equal(admin.publicAccess,false);
  for(const [route,method,body]of[['/api/people','GET'],['/api/settings/profile','PATCH',{name:'Unauthorized'}],['/api/settings/password','POST',{currentPassword:'review',newPassword:'changed'}],['/api/drive/status','GET'],['/api/drive/connect','POST'],['/api/assets/demo/optimize','POST'],['/api/assets/demo/migrate-r2','POST'],['/api/projects/launch/drive-import','POST',{fileId:'anything'}]])assert.equal((await request(route,method,body)).status,401,route);
  for(const route of ['/api/projects','/api/reviews','/api/storage/status','/api/assets/demo','/api/assets/demo/poster','/api/assets/demo/comments','/api/assets/demo/video'])assert.equal((await request(route)).status,200,route);
  const range=await request('/api/assets/demo/video','GET',null,{headers:{range:'bytes=0-15'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,16);
  const project=await(await request('/api/projects','POST',{name:'Open workflow'})).json();const form=new FormData();form.append('video',new Blob([readFileSync(path.join(root,'public/demo.mp4'))]),'Public.mp4');const upload=await request('/api/projects/'+project.id+'/assets','POST',form);assert.equal(upload.status,201);const asset=await upload.json();
  const created=await request('/api/assets/'+asset.id+'/comments','POST',{author:'Client',body:'No account required',time:2,hotspot:{x:.2,y:.5}});assert.equal(created.status,201);const comment=await created.json();assert.equal((await request('/api/assets/'+asset.id+'/comments/'+comment.id,'PATCH',{body:'Updated publicly'})).status,200);
  assert.equal((await request('/api/assets/'+asset.id+'/comments/'+comment.id,'PATCH',{resolved:true})).status,200);
  const link=await(await request('/api/assets/'+asset.id+'/share','POST')).json(),base='/api/reviews/'+link.token;const guest=await(await request(base+'/session')).json();assert.equal(guest.authenticated,true);assert.equal(guest.publicAccess,true);assert.equal(guest.expiresAt,null);assert.equal(guest.canManageFeedback,false);
  for(const tail of ['','/video','/poster','/comments','/playback-status'])assert.equal((await request(base+tail)).status,200);
  assert.equal((await request(base+'/comments/'+comment.id,'PATCH',{body:'Not my feedback'})).status,403);
  const own=await(await request(base+'/comments','POST',{author:'Guest',body:'My feedback',time:3})).json();assert.equal((await request(base+'/comments/'+own.id,'PATCH',{body:'My edited feedback',editToken:own.editToken})).status,200);
  assert.equal((await request(base+'/status','PATCH',{status:'Approved'})).status,200);
  assert.equal((await request('/api/assets/'+asset.id+'/move','POST',{projectId:'launch'})).status,200);
  assert.equal((await request('/api/assets/'+asset.id+'/share','DELETE')).status,204);assert.equal((await request(base)).status,404);assert.equal((await request(base+'/session')).status,404);
  const keepLink=await(await request('/api/assets/demo/share','POST')).json();
  // Public access does not mint or extend privileged sessions, and expired admin cookies stay expired.
  const db=new DatabaseSync(path.join(dir,'review.sqlite'));assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n,1);db.prepare('UPDATE sessions SET expires_at=?').run(Date.now()-1);db.close();
  assert.equal((await request('/api/projects','GET',null,{headers:{cookie:ownerCookie}})).status,200);assert.equal((await request('/api/people','GET',null,{headers:{cookie:ownerCookie}})).status,401);
  await server.stop();server=await startServer(dir,{WORKSPACE_PASSWORD_REQUIRED:'true'});assert.equal((await(await request('/api/session')).json()).authenticated,false);assert.equal((await request('/api/projects')).status,401);assert.equal((await request('/api/reviews/'+keepLink.token+'/video')).status,401);
  const login=await request('/api/login','POST',{password:'review'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/assets/'+asset.id+'/comments','GET',null,{headers:{cookie}})).status,200);assert.equal((await request('/api/assets/'+asset.id,'DELETE',null,{headers:{cookie}})).status,204);
  // Anonymous R2 playback still issues bounded private URLs without needing a session expiry.
  await server.stop();const cloud=new DatabaseSync(path.join(dir,'review.sqlite'));cloud.prepare('UPDATE assets SET filename=? WHERE id=?').run('r2:'+Buffer.from('pvr/launch/fixture.mp4').toString('base64url'),'demo');cloud.close();
  server=await startServer(dir,{WORKSPACE_PASSWORD_REQUIRED:'false',R2_ACCOUNT_ID:'a'.repeat(32),R2_ACCESS_KEY_ID:'fixture-access',R2_SECRET_ACCESS_KEY:'fixture-secret',R2_BUCKET_NAME:'review-videos'});
  for(const route of ['/api/assets/demo/video','/api/reviews/'+keepLink.token+'/video']){const playback=await request(route,'GET',null,{redirect:'manual'});assert.equal(playback.status,307);assert.equal(new URL(playback.headers.get('location')).searchParams.get('X-Amz-Expires'),'300');}
 }finally{await server.stop();rmSync(dir,{recursive:true,force:true});}
});
