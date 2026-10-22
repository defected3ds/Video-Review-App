// Integration test against PostgreSQL + PostgREST; no real Supabase credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { supabaseDatabase } from '../server/database.mjs';
import { startServer } from './helpers.mjs';

const suffix=randomBytes(5).toString('hex'), network=`pvr-test-${suffix}`, pg=`pvr-pg-${suffix}`, rest=`pvr-rest-${suffix}`;
const dir=mkdtempSync(path.join(tmpdir(),'pvr-remote-'));
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['pipe','pipe','pipe']}).trim();
const secret='local-integration-test-signing-key-never-used-in-production';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const payload=`${encode({alg:'HS256',typ:'JWT'})}.${encode({role:'service_role',exp:Math.floor(Date.now()/1000)+3600})}`;
const key=`${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;
let server;
try {
  docker('network','create',network);
  docker('run','--rm','-d','--name',pg,'--network',network,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine');
  for(let i=0;;i++) {
    try{docker('exec',pg,'pg_isready','-h','127.0.0.1','-U','postgres');break;}catch(error){if(i===60)throw error;await new Promise(r=>setTimeout(r,200));}
  }
  const roles='CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;';
  execFileSync('docker',['exec','-i',pg,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:roles+'\n'+readFileSync('supabase/schema.sql','utf8'),stdio:['pipe','pipe','pipe']});
  // Applying the schema again must be safe.
  execFileSync('docker',['exec','-i',pg,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:readFileSync('supabase/schema.sql','utf8'),stdio:['pipe','pipe','pipe']});
  for(let i=0;i<2;i++)execFileSync('docker',['exec','-i',pg,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:readFileSync('supabase/profiles.sql','utf8'),stdio:['pipe','pipe','pipe']});
  docker('run','--rm','-d','--name',rest,'--network',network,'-p','127.0.0.1::3000','-e',`PGRST_DB_URI=postgres://postgres@${pg}:5432/postgres`,'-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${secret}`,'postgrest/postgrest:v13.0.7');
  const port=docker('port',rest,'3000/tcp').split(':').at(-1),url=`http://127.0.0.1:${port}`;
  for(let i=0;;i++) {
    try{const r=await fetch(url);if(r.status===200)break;throw new Error(`REST readiness ${r.status}`);}catch(error){if(i===60)throw error;await new Promise(r=>setTimeout(r,200));}
  }
  const database=supabaseDatabase({url,key,allowLocal:true,fetcher:(target,options)=>fetch(String(target).replace('/rest/v1/','/'),options)});
  // The hosted adapter expects Supabase's /rest/v1 prefix. A local forwarding gateway
  // supplies that prefix for full Express API tests without changing provider code.
  const {createServer}=await import('node:http');
  const gateway=createServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const response=await fetch(url+req.url.replace(/^\/rest\/v1/,''),{method:req.method,headers:{authorization:req.headers.authorization||'',apikey:req.headers.apikey||'','content-type':'application/json',prefer:req.headers.prefer||''},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
      res.writeHead(response.status,{'content-type':'application/json'});res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(502);res.end();}
  });
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  try {
    const anonymous=await fetch(url+'/pvr_owner');assert.equal(anonymous.status,401);
    assert.equal((await fetch(url+'/pvr_connections')).status,401);
    assert.equal((await fetch(url+'/pvr_profiles')).status,401);
    await database.saveConnection('oauth:test','encrypted-state',Date.now()+60000);
    await database.saveConnection('oauth:test','updated-state',Date.now()+60000);
    assert.equal((await database.consumeConnection('oauth:test')).payload,'updated-state');
    assert.equal(await database.consumeConnection('oauth:test'),undefined);
    const env={SUPABASE_URL:`http://127.0.0.1:${gateway.address().port}`,SUPABASE_SECRET_KEY:key,SUPABASE_ALLOW_LOCAL_TEST:'1'};
    server=await startServer(dir,env);let cookie='';
    const request=(route,method='GET',body,auth=true)=>fetch(server.base+route,{method,headers:{...(auth&&cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const setup=await request('/api/setup','POST',{name:'Remote test owner',password:'review'});assert.equal(setup.status,201);cookie=setup.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/setup','POST',{name:'Other owner',password:'another-test-password'})).status,409);
    const project=await (await request('/api/projects','POST',{name:'Persistent project'})).json();assert.ok(project.id);
    await database.createAsset({id:'test-video',project_id:project.id,name:'Remote sample.mp4',filename:null,poster:'demo',size:0,duration:8,fps:25});
    const feedback={author:'Client',body:'Please fix this frame.',time:2,annotations:'[{"color":"#ff0000","points":[{"x":0.2,"y":0.3}]}]',hotspot:'{"x":0.4,"y":0.5}'};
    const invite=await (await request('/api/assets/test-video/share','POST')).json();assert.ok(invite.token);
    const response=await request(`/api/reviews/${invite.token}/comments`,'POST',{...feedback,annotations:JSON.parse(feedback.annotations),hotspot:JSON.parse(feedback.hotspot)},false);assert.equal(response.status,201);const comment=await response.json();assert.equal(comment.frame,50);
    assert.equal((await request(`/api/reviews/${invite.token}/status`,'PATCH',{status:'Approved'},false)).status,200);
    assert.equal((await request(`/api/assets/test-video/comments/${comment.id}`,'PATCH',{resolved:true})).status,200);
    const projects=await (await request('/api/projects')).json();assert.equal(projects[0].asset_count,1);
    const assets=await (await request(`/api/projects/${project.id}/assets`)).json();assert.equal(assets[0].comment_count,0);
    const queue=await (await request('/api/reviews')).json();assert.equal(queue[0].project_name,'Persistent project');assert.equal(queue[0].status,'Approved');assert.equal(queue[0].comment_count,0);assert.equal(queue[0].filename,undefined);
    await server.stop();rmSync(dir,{recursive:true,force:true});server=await startServer(dir,env);
    assert.equal((await (await request('/api/assets/test-video')).json()).status,'Approved');
    const comments=await (await request('/api/assets/test-video/comments')).json();assert.deepEqual(comments[0].hotspot,{x:.4,y:.5});assert.equal(comments[0].resolved,true);
    assert.equal((await request('/api/projects/'+project.id,'DELETE',null,false)).status,401);
    assert.equal((await request('/api/projects/'+project.id,'DELETE')).status,204);
    assert.equal((await request(`/api/reviews/${invite.token}`,'GET',null,false)).status,404);
    assert.deepEqual(await database.comments('test-video'),[]);
    assert.deepEqual(await database.projects(),[]);
    await database.createProject('replacement-test','Review copy test');
    const oldReference='b2:old:'+Buffer.from('pvr/test/old.mp4').toString('base64url'),newReference='b2:new:'+Buffer.from('pvr/test/new-review.mp4').toString('base64url');
    await database.createAsset({id:'replacement-video',project_id:'replacement-test',name:'Source.mp4',filename:oldReference,size:119000000,duration:8,fps:25,poster:'demo'});
    assert.equal(await database.replaceVideo('replacement-video','stale-reference',{filename:newReference,size:9000000,name:'Source.mp4'}),0);
    assert.equal(await database.replaceVideo('replacement-video',oldReference,{filename:newReference,size:9000000,name:'Source.mp4'}),1);
    assert.equal((await database.asset('replacement-video')).size,9000000);assert.equal((await database.asset('replacement-video')).fps,25);
    await database.deleteProject('replacement-test');

    await server.stop();server=await startServer(dir,env);assert.deepEqual(await (await request('/api/projects')).json(),[]);
    assert.equal((await request('/api/logout','POST')).status,204);
    assert.equal((await request('/api/projects')).status,401);
    const login=await request('/api/login','POST',{password:'review'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/settings/profile','PATCH',{name:'Remote admin'})).status,200);
    const oldCookie=cookie;
    const changed=await request('/api/settings/password','POST',{currentPassword:'review',newPassword:'newpass'});assert.equal(changed.status,200);cookie=changed.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(server.base+'/api/projects',{headers:{cookie:oldCookie}})).status,401);
    assert.equal((await request('/api/projects')).status,200);
    await server.stop();server=await startServer(dir,env);
    assert.equal((await (await request('/api/session')).json()).name,'Remote admin');
    assert.equal((await request('/api/login','POST',{password:'review'},false)).status,401);
    assert.equal((await request('/api/login','POST',{password:'newpass'},false)).status,200);
    assert.equal((await (await request('/api/people')).json()).length,2);
    const newPerson=await request('/api/login','POST',{nickname:'Remote client',password:'newpass'},false);assert.equal(newPerson.status,200);const person=await newPerson.json();assert.equal(person.name,'Remote client');
    const returning=await (await request('/api/login','POST',{nickname:'REMOTE CLIENT',password:'newpass'},false)).json();assert.equal(returning.profileId,person.profileId);
    await server.stop();
    // Existing deployments can keep signing in before the additive profile migration.
    execFileSync('docker',['exec','-i',pg,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:"ALTER TABLE public.pvr_sessions DROP COLUMN profile_id; DROP TABLE public.pvr_profiles; NOTIFY pgrst, 'reload schema';",stdio:['pipe','pipe','pipe']});
    server=await startServer(dir,env);
    const legacySession=await (await request('/api/session')).json();assert.equal(legacySession.authenticated,true);assert.equal(legacySession.profilesEnabled,false);
    assert.equal((await request('/api/login','POST',{password:'wrong'},false)).status,401);
    assert.equal((await request('/api/login','POST',{password:'newpass'},false)).status,200);
    assert.equal((await request('/api/login','POST',{nickname:'New profile',password:'newpass'},false)).status,503);
    assert.equal((await request('/api/projects')).status,200);
    assert.equal((await request('/api/people')).status,503);
    await server.stop();
    execFileSync('docker',['exec','-i',pg,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:readFileSync('supabase/profiles.sql','utf8'),stdio:['pipe','pipe','pipe']});
    server=await startServer(dir,env);
    assert.equal((await (await request('/api/session')).json()).profilesEnabled,true);
    assert.equal((await request('/api/login','POST',{nickname:'New profile',password:'newpass'},false)).status,200);
    console.log('PASS: pre-migration password sign-in remains active; additive migration enables nickname profiles without changing credentials');
    console.log('PASS: Supabase profile/password updates persist, revoked sessions are denied, and new credentials work after restart');
    console.log('PASS: PostgreSQL/PostgREST schema repeatability, anonymous denial, owner sessions, project/asset counts, guest feedback, drawings, approvals, resolve, restart with erased local data, cascade deletion, and login');
  }finally{await new Promise(resolve=>gateway.close(resolve));}
}finally{
  if(server)await server.stop();
  for(const container of [rest,pg])try{docker('rm','-f',container);}catch{}
  try{docker('network','rm',network);}catch{}
  rmSync(dir,{recursive:true,force:true});
}
