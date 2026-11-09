import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startServer} from './helpers.mjs';
import {d1Database} from '../server/database.mjs';

const accountId='0123456789abcdef0123456789abcdef',databaseId='11111111-2222-3333-4444-555555555555',token='d1-test-token';

// Minimal stand-in for Cloudflare's D1 query API, backed by node:sqlite with D1's restrictions.
async function fakeD1() {
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  const calls=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
    if(req.method!=='POST'||req.url!==`/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`)return reply(404,{success:false,errors:[{message:'not found'}]});
    if(req.headers.authorization!==`Bearer ${token}`)return reply(401,{success:false,errors:[{code:10000,message:'Authentication error'}]});
    const {sql,params=[]}=JSON.parse(raw);calls.push({sql,params});
    if(/\b(BEGIN|COMMIT|ROLLBACK)\b|journal_mode/i.test(sql))return reply(400,{success:false,errors:[{message:'not authorized'}]});
    try{
      const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);
      if(statements.length>1&&params.length)throw new Error('params with multiple statements');
      if(!params.every(value=>typeof value==='string'))throw new Error('params must be strings');
      const result=statements.map(statement=>{
        const prepared=db.prepare(statement);
        if(/^(SELECT|PRAGMA)|RETURNING/i.test(statement))return {results:prepared.all(...params),success:true,meta:{changes:0}};
        const info=prepared.run(...params);return {results:[],success:true,meta:{changes:Number(info.changes)}};
      });
      reply(200,{success:true,errors:[],messages:[],result});
    }catch(error){reply(400,{success:false,errors:[{code:7500,message:`${error.message}: SQLITE_ERROR`}]});}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {base:`http://127.0.0.1:${server.address().port}`,db,calls,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('Cloudflare D1 store creates the schema and keeps projects, comments, sessions and connections',async()=>{
  const d1=await fakeD1();
  try{
    const store=d1Database({accountId,databaseId,token,apiBase:d1.base,allowLocal:true});
    assert.deepEqual(await store.projects(),[],'D1 starts without demo content');
    await store.createProject('p1','Campaign');await store.createProject('p2','Guides');
    await store.createAsset({id:'a1',project_id:'p1',name:'Film.mp4',filename:'r2:film.mp4',size:10,duration:5,fps:25,poster:null});
    await store.createComment({id:'c1',asset_id:'a1',author:'A',body:'Fix logo',time:1,frame:25,annotations:'[]',hotspot:null});
    assert.equal((await store.projects()).find(p=>p.id==='p1').asset_count,1);
    assert.equal((await store.assets('p1'))[0].comment_count,1);
    assert.equal(await store.resolve('a1','c1',true),1);assert.equal(await store.resolve('a1','missing',true),0);
    assert.equal((await store.assets('p1'))[0].comment_count,0);
    assert.equal(await store.moveAsset('a1','p1','p2'),1);assert.equal(await store.moveAsset('a1','p1','p2'),0,'stale moves are rejected');
    assert.equal(await store.replaceVideo('a1','r2:film.mp4',{filename:'r2:new.mp4',size:20,name:'New.mp4'}),1);
    await store.createSession('s1',Date.now()+60000);assert.equal((await store.session('s1',Date.now())).token,'s1');
    await store.createConnectionOnce('key','first');await store.createConnectionOnce('key','second');
    assert.equal((await store.connection('key')).payload,'first');
    assert.equal((await store.consumeConnection('key')).payload,'first');assert.equal(await store.connection('key'),undefined);
    await assert.rejects(store.createProject('p1','Duplicate'),error=>error.status===409);
    await store.deleteProject('p2');
    assert.deepEqual((await store.projects()).map(p=>p.id),['p1']);assert.equal(await store.asset('a1'),undefined);
    assert.equal(d1.db.prepare('SELECT count(*) AS n FROM comments').get().n,0);
    const bad=d1Database({accountId,databaseId,token:'wrong',apiBase:d1.base,allowLocal:true});
    await assert.rejects(bad.projects(),error=>error.status===503&&!error.message.includes('wrong'));
    assert.throws(()=>d1Database({accountId,databaseId,token,apiBase:'http://example.com'}),/HTTPS/);
  }finally{await d1.close();}
});

test('The server runs on Cloudflare D1, keeps data across restarts, and reports a missing database without crashing',async()=>{
  const d1=await fakeD1(),dir=mkdtempSync(path.join(tmpdir(),'pvr-d1-'));
  const env={D1_DATABASE_ID:databaseId,CLOUDFLARE_ACCOUNT_ID:accountId,CLOUDFLARE_D1_TOKEN:token,D1_TEST_ENDPOINT:d1.base,MAX_UPLOAD_MB:'95'};
  let server=await startServer(dir,env);
  const request=(route,method='GET',body,cookie='')=>fetch(server.base+route,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  try{
    assert.equal((await request('/api/health')).status,200);
    const session=await (await request('/api/session')).json();assert.equal(session.maxUploadMB,95);
    const setup=await request('/api/setup','POST',{name:'Owner',password:'shared-password'});assert.equal(setup.status,201);
    const cookie=setup.headers.get('set-cookie').split(';')[0];
    const project=await (await request('/api/projects','POST',{name:'Cloudflare project'},cookie)).json();
    d1.db.prepare("INSERT INTO assets (id,project_id,name,filename,duration) VALUES ('v1',?,'Clip.mp4','r2:clip.mp4',10)").run(project.id);
    const comment=await request('/api/assets/v1/comments','POST',{author:'Owner',body:'Stored in D1',time:2},cookie);assert.equal(comment.status,201);
    await server.stop();server=await startServer(dir,env);
    const login=await request('/api/login','POST',{password:'shared-password'});assert.equal(login.status,200);
    const again=login.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await (await request('/api/projects','GET',null,again)).json()).map(p=>p.name),['Cloudflare project']);
    assert.deepEqual((await (await request('/api/assets/v1/comments','GET',null,again)).json()).map(c=>c.body),['Stored in D1']);
    await server.stop();
    // An unreachable database must not crash startup (the Render outage); requests report it instead.
    server=await startServer(dir,{...env,D1_TEST_ENDPOINT:'http://127.0.0.1:9'});
    const health=await request('/api/health');assert.equal(health.status,503);
    assert.match((await health.json()).error,/database is unavailable/);
  }finally{await server.stop();await d1.close();rmSync(dir,{recursive:true,force:true});}
});
