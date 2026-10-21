// Packaging smoke check, using a local read-only Supabase fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
const name=`pvr-container-${randomBytes(4).toString('hex')}`;
const backend=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('[]');});
await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
let child;
try{
  const result=execFileSync('docker',['run','--rm','--entrypoint','node','pipelife-review:local','-e',"const cp=require('node:child_process');for(const tool of ['ffmpeg','ffprobe'])cp.execFileSync(tool,['-version']);if(!require('node:fs').existsSync('/app/dist/index.html'))process.exit(1);console.log('runtime tools and frontend present')"],{encoding:'utf8',timeout:30000});assert.match(result,/runtime tools and frontend present/);
  child=spawn('docker',['run','--rm','--name',name,'--network','host','-e',`SUPABASE_URL=http://127.0.0.1:${backend.address().port}`,'-e','SUPABASE_SECRET_KEY=local-container-test-only','-e','SUPABASE_ALLOW_LOCAL_TEST=1','-e','WORKSPACE_SETUP_TOKEN=local-container-setup-code','-e','HOST=127.0.0.1','-e','PORT=0','pipelife-review:local'],{stdio:['ignore','pipe','pipe']});
  let output='';const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Container failed to start.')),15000);
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/listening on (\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});
    child.stderr.on('data',chunk=>{output+=chunk;});child.on('exit',()=>{clearTimeout(timer);reject(new Error('Container exited before readiness.'));});child.on('error',reject);
  });
  assert.deepEqual(await (await fetch(base+'/api/health')).json(),{ok:true});
  const session=await (await fetch(base+'/api/session')).json();assert.equal(session.setupRequired,true);assert.equal(session.setupTokenRequired,true);
  const unauthorized=await fetch(base+'/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Other',password:'not-a-real-password'})});assert.equal(unauthorized.status,403);
  const html=await (await fetch(base)).text();assert.match(html,/\/assets\/index-/);const asset=html.match(/src="([^"]+\.js)"/)[1];assert.equal((await fetch(base+asset)).status,200);
  console.log('PASS: production container starts as configured, includes FFmpeg/frontend, checks its database, serves compiled assets, and protects owner setup');
}finally{
  try{execFileSync('docker',['rm','-f',name],{stdio:'ignore'});}catch{}
  if(child&&child.exitCode===null)await once(child,'exit');
  await new Promise(resolve=>backend.close(resolve));
}
