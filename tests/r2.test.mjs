import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {R2Storage,r2MaxBytes} from '../server/r2.mjs';
import {startServer,root} from './helpers.mjs';

const accessKey='fixture-r2-access-key',secret='fixture-r2-secret-never-used-remotely',accountId='a'.repeat(32),bucket='review-videos';
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const sha=value=>createHash('sha256').update(value).digest('hex');
function validSignature(req,url){
  const query=url.searchParams.has('X-Amz-Signature'),auth=req.headers.authorization||'';
  const credential=query?url.searchParams.get('X-Amz-Credential'):auth.match(/Credential=([^, ]+)/)?.[1];
  const signed=query?url.searchParams.get('X-Amz-SignedHeaders'):auth.match(/SignedHeaders=([^, ]+)/)?.[1];
  const signature=query?url.searchParams.get('X-Amz-Signature'):auth.match(/Signature=([a-f0-9]+)/)?.[1];
  if(!credential||!signed||!signature)return false;
  const [key,date,region,service,end]=credential.split('/');if(key!==accessKey||region!=='auto'||service!=='s3'||end!=='aws4_request')return false;
  const timestamp=query?url.searchParams.get('X-Amz-Date'):req.headers['x-amz-date'];if(!timestamp)return false;
  if(query){const instant=Date.parse(timestamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,'$1-$2-$3T$4:$5:$6Z'));if(Date.now()>instant+Number(url.searchParams.get('X-Amz-Expires'))*1000)return false;}
  const canonicalQuery=[...url.searchParams].filter(([name])=>name!=='X-Amz-Signature').map(([a,b])=>[encode(a),encode(b)]).sort(([a,b],[c,d])=>a<c?-1:a>c?1:b<d?-1:b>d?1:0).map(([a,b])=>a+'='+b).join('&');
  const headers=signed.split(';').map(name=>name+':'+String(req.headers[name]||'').trim().replace(/\s+/g,' ')+'\n').join('');
  const payload=req.headers['x-amz-content-sha256']||'UNSIGNED-PAYLOAD';
  const canonical=[req.method,url.pathname,canonicalQuery,headers,signed,payload].join('\n');
  const string=['AWS4-HMAC-SHA256',timestamp,[date,region,service,end].join('/'),sha(canonical)].join('\n');
  let signing=Buffer.from('AWS4'+secret);for(const part of [date,region,service,end])signing=createHmac('sha256',signing).update(part).digest();
  const expected=createHmac('sha256',signing).update(string).digest('hex');
  return signature.length===expected.length&&timingSafeEqual(Buffer.from(signature),Buffer.from(expected));
}

test('R2 signed uploads, direct owner/guest playback, quotas and legacy migration preserve reviews',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pvr-r2-')),video=readFileSync(path.join(root,'public/demo.mp4')),objects=new Map();
  let server,cookie='',extraBytes=0,deleteDuringUpload,b2Capped=false,b2Reads=0,uploads=0;
  const provider=createServer(async(req,res)=>{
    try{
      if(req.headers['x-provider-url']){
        const url=new URL(req.headers['x-provider-url']);
        const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
        if(url.pathname.endsWith('b2_authorize_account'))return json({accountId:'legacy-account',authorizationToken:'legacy-token',apiInfo:{storageApi:{apiUrl:'https://api001.backblazeb2.com',downloadUrl:'https://f001.backblazeb2.com',allowed:{buckets:[{id:'legacy-bucket'}],capabilities:['listBuckets','listFiles','readFiles','writeFiles','deleteFiles']}}}});
        if(url.pathname.endsWith('b2_download_file_by_id')){if(b2Capped)return json({code:'cap_exceeded'},403);b2Reads++;res.writeHead(200,{'content-type':'video/mp4','content-length':video.length});return res.end(video);}
        throw Error('Migration must retain the Backblaze source and use R2 for new writes');
      }
      const url=new URL(req.url,`http://${req.headers.host}`);
      if(!validSignature(req,url)){res.writeHead(403,{'content-type':'application/xml'});return res.end('<Error><Code>AccessDenied</Code></Error>');}
      const key=decodeURIComponent(url.pathname.slice(bucket.length+2));
      if(url.searchParams.get('list-type')==='2'){
        const entries=[...objects].map(([Key,value])=>({Key,Size:value.bytes.length}));if(extraBytes)entries.push({Key:'other-object',Size:extraBytes});
        const start=Number(url.searchParams.get('continuation-token')||0),page=entries.slice(start,start+2),more=start+2<entries.length;
        res.writeHead(200,{'content-type':'application/xml'});return res.end('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>'+more+'</IsTruncated>'+page.map(o=>`<Contents><Key>${o.Key}</Key><Size>${o.Size}</Size></Contents>`).join('')+(more?`<NextContinuationToken>${start+2}</NextContinuationToken>`:'')+'</ListBucketResult>');
      }
      if(req.method==='PUT'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
        assert.equal(Number(req.headers['content-length']),bytes.length);assert.equal(req.headers['content-md5'],createHash('md5').update(bytes).digest('base64'));assert.equal(req.headers['x-amz-meta-sha256'],sha(bytes));assert.equal(req.headers['cache-control'],'private, no-store');
        objects.set(key,{bytes,hash:sha(bytes),type:req.headers['content-type']});uploads++;
        if(deleteDuringUpload){const id=deleteDuringUpload;deleteDuringUpload=null;await request('/api/projects/'+id,'DELETE');}
        res.writeHead(200,{etag:'"'+sha(bytes)+'"'});return res.end();
      }
      if(req.method==='DELETE'){objects.delete(key);res.writeHead(204);return res.end();}
      const object=objects.get(key);if(!object){res.writeHead(404);return res.end();}
      if(req.method==='HEAD'){res.writeHead(200,{'content-length':object.bytes.length,'content-type':object.type,'x-amz-meta-sha256':object.hash});return res.end();}
      if(req.method==='GET'){
        let start=0,end=object.bytes.length-1,status=200;
        if(req.headers.range){const match=req.headers.range.match(/^bytes=(\d+)-(\d*)$/);start=Number(match[1]);end=match[2]?Math.min(end,Number(match[2])):end;status=206;}
        res.writeHead(status,{'content-type':object.type,'content-length':end-start+1,'accept-ranges':'bytes',...(status===206?{'content-range':`bytes ${start}-${end}/${object.bytes.length}`}:{})});return res.end(object.bytes.subarray(start,end+1));
      }
      throw Error('Unexpected fixture method');
    }catch(error){console.error(error.message);res.writeHead(500);res.end();}
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${provider.address().port}`;
  const env={R2_ACCOUNT_ID:accountId,R2_ACCESS_KEY_ID:accessKey,R2_SECRET_ACCESS_KEY:secret,R2_BUCKET_NAME:bucket,R2_TEST_ENDPOINT:endpoint,B2_KEY_ID:'legacy-key',B2_APPLICATION_KEY:'legacy-secret',B2_BUCKET_ID:'legacy-bucket',MOCK_B2_URL:endpoint,NODE_OPTIONS:`--import=${path.join(root,'tests/b2-fetch-preload.mjs')}`};
  const request=(route,method='GET',body,auth=true,options={})=>fetch(server.base+route,{method,headers:{...(auth&&cookie?{cookie}:{}),...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{}),...options.headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,...(options.redirect?{redirect:options.redirect}:{})});
  const upload=project=>{const form=new FormData();form.append('video',new Blob([video],{type:'video/mp4'}),'Review.mp4');return request('/api/projects/'+project+'/assets','POST',form);};
  let asset,invite;
  try{
    server=await startServer(dir,env);
    await t.test('R2 becomes the write destination and credentials are never returned',async()=>{
      assert.equal((await request('/api/storage/status','GET',null,false)).status,401);
      const setup=await request('/api/setup','POST',{name:'Owner',password:'review'});assert.equal(setup.status,201);cookie=setup.headers.get('set-cookie').split(';')[0];
      const status=await (await request('/api/storage/status')).json();assert.equal(status.provider,'r2');assert.equal(status.connected,true);assert.equal(status.maxBytes,r2MaxBytes);assert.ok(!JSON.stringify(status).includes(secret));
      const result=await upload('launch');assert.equal(result.status,201);asset=await result.json();assert.equal(asset.inR2,true);assert.equal(asset.inB2,false);assert.equal(asset.reviewCopy,false);assert.equal(asset.size,video.length);assert.deepEqual([...objects.values()][0].bytes,video);assert.equal(asset.filename,undefined);assert.equal(objects.size,1);assert.equal(b2Reads,0);assert.deepEqual(readdirSync(path.join(dir,'uploads')),[]);
    });
    await t.test('authenticated redirects deliver private byte ranges directly from storage',async()=>{
      assert.equal((await request(`/api/assets/${asset.id}/video`,'GET',null,false)).status,401);
      const response=await request(`/api/assets/${asset.id}/video`,'GET',null,true,{redirect:'manual'});assert.equal(response.status,307);const url=new URL(response.headers.get('location'));
      assert.equal(url.origin,endpoint);assert.equal(url.searchParams.get('X-Amz-Expires'),'300');assert.equal(url.searchParams.get('X-Amz-Algorithm'),'AWS4-HMAC-SHA256');assert.ok(!url.href.includes(secret));
      const playback=await fetch(url,{headers:{Range:'bytes=10-99'}});assert.equal(playback.status,206);assert.deepEqual(Buffer.from(await playback.arrayBuffer()),[...objects.values()][0].bytes.subarray(10,100));
      const unsigned=await fetch(url.origin+url.pathname);assert.equal(unsigned.status,403);
      const tampered=new URL(url);tampered.pathname+='.another';assert.equal((await fetch(tampered)).status,403);
      invite=await (await request(`/api/assets/${asset.id}/share`,'POST')).json();
      const guest=await request(`/api/reviews/${invite.token}/video`,'GET',null,false,{redirect:'manual'});assert.equal(guest.status,307);assert.equal((await fetch(guest.headers.get('location'))).status,200);
      assert.equal((await request(`/api/assets/${asset.id}/video`,'GET',null,true,{headers:{Range:'bad-range'},redirect:'manual'})).status,416);
    });
    await t.test('free bucket guard prevents writes; failed database save rolls back the new object',async()=>{
      const before=uploads;extraBytes=r2MaxBytes;assert.equal((await upload('launch')).status,413);assert.equal(uploads,before);extraBytes=0;
      const project=await (await request('/api/projects','POST',{name:'Rollback'})).json();deleteDuringUpload=project.id;const count=objects.size;
      assert.equal((await upload(project.id)).status,500);assert.equal(objects.size,count);assert.deepEqual(readdirSync(path.join(dir,'uploads')),[]);
    });
    await t.test('Backblaze migration retains feedback, approval, share tokens and source files',async()=>{
      const db=new DatabaseSync(path.join(dir,'review.sqlite'));db.prepare('UPDATE assets SET filename=?,size=? WHERE id=?').run('b2:legacy-file:'+Buffer.from('pvr/launch/legacy.mp4').toString('base64url'),video.length,'demo');db.close();
      const legacyShare=await (await request('/api/assets/demo/share','POST')).json();
      const feedback={author:'Client',body:'Keep this pin',time:3,hotspot:{x:.4,y:.6},annotations:[{color:'#ec4047',points:[{x:.2,y:.3},{x:.4,y:.5}]}]};assert.equal((await request('/api/assets/demo/comments','POST',feedback)).status,201);
      await request('/api/assets/demo','PATCH',{status:'Approved'});
      assert.equal((await request('/api/assets/demo/migrate-r2','POST',null,false)).status,401);assert.equal((await request(`/api/reviews/${legacyShare.token}/migrate-r2`,'POST',null,false)).status,404);
      const count=objects.size;b2Capped=true;assert.equal((await request('/api/assets/demo/migrate-r2','POST')).status,503);assert.equal(objects.size,count);assert.equal((await (await request('/api/assets/demo')).json()).inB2,true);
      b2Capped=false;const moved=await request('/api/assets/demo/migrate-r2','POST');assert.equal(moved.status,200);const value=await moved.json();assert.equal(value.asset.id,'demo');assert.equal(value.asset.status,'Approved');assert.equal(value.asset.inR2,true);assert.equal(value.asset.fps,25);assert.equal(value.asset.duration,8);assert.equal(value.bytesSaved,0);assert.equal(value.asset.reviewCopy,false);assert.deepEqual([...objects.values()].at(-1).bytes,video);assert.equal(b2Reads,1);
      const shared=await (await request(`/api/reviews/${legacyShare.token}`,'GET',null,false)).json();assert.equal(shared.asset.id,'demo');assert.equal(shared.asset.inR2,true);
      const comments=await (await request(`/api/reviews/${legacyShare.token}/comments`,'GET',null,false)).json();assert.ok(comments.some(c=>c.body==='Keep this pin'&&c.hotspot.x===.4&&c.annotations.length));
      const ready=await request(`/api/reviews/${legacyShare.token}/video`,'GET',null,false,{redirect:'manual'});assert.equal(ready.status,307);assert.equal((await fetch(ready.headers.get('location'))).status,200);
      assert.equal((await (await request('/api/assets/demo/migrate-r2','POST')).json()).alreadyMoved,true);assert.equal(b2Reads,1);assert.deepEqual(readdirSync(path.join(dir,'uploads')),[]);
    });
    await t.test('migration preserves existing review-copy bytes and labels without another encode',async()=>{
      const db=new DatabaseSync(path.join(dir,'review.sqlite'));
      db.prepare('INSERT INTO assets (id,project_id,name,filename,size,duration,fps,poster) VALUES (?,?,?,?,?,?,?,?)').run('existing-review','launch','Already compact.mp4','b2:legacy-review:'+Buffer.from('pvr/launch/legacy-review.mp4').toString('base64url'),video.length,8,25,'demo');db.close();
      const response=await request('/api/assets/existing-review/migrate-r2','POST');assert.equal(response.status,200);const moved=await response.json();
      assert.equal(moved.bytesSaved,0);assert.equal(moved.asset.reviewCopy,true);assert.equal(moved.asset.size,video.length);assert.deepEqual([...objects.values()].at(-1).bytes,video);
    });
    await t.test('restart retains playback; revocation stops new playback links; originals survive project deletion',async()=>{
      await server.stop();server=await startServer(dir,env);assert.equal((await request(`/api/reviews/${invite.token}/video`,'GET',null,false,{redirect:'manual'})).status,307);
      await request(`/api/assets/${asset.id}/share`,'DELETE');assert.equal((await request(`/api/reviews/${invite.token}/video`,'GET',null,false,{redirect:'manual'})).status,404);
      const count=objects.size;assert.equal((await request(`/api/assets/${asset.id}`,'DELETE')).status,204);assert.equal(objects.size,count);
      assert.equal((await request(`/api/assets/${asset.id}/video`,'GET',null,true,{redirect:'manual'})).status,404);
      assert.equal((await request('/api/assets/demo')).status,200);assert.ok((await (await request('/api/projects')).json()).some(p=>p.id==='launch'));
      await request('/api/projects/launch','DELETE');assert.equal(objects.size,count);
    });
    await t.test('partial R2 settings fail clearly instead of sending new files to Backblaze',async()=>{
      await server.stop();server=await startServer(dir,{...env,R2_SECRET_ACCESS_KEY:''});const project=await (await request('/api/projects','POST',{name:'Partial settings'})).json();
      assert.equal((await (await request('/api/storage/status')).json()).connected,false);assert.equal((await upload(project.id)).status,503);
    });
  }finally{if(server)await server.stop();await new Promise(resolve=>provider.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('R2 rejects invalid endpoints and object keys before disclosing credentials',async()=>{
  const settings={accountId,accessKeyId:accessKey,secretAccessKey:secret,bucket};
  for(const endpoint of ['https://attacker.example','http://'+accountId+'.r2.cloudflarestorage.com','https://'+accountId+'.r2.cloudflarestorage.com.attacker.example','https://user:pass@'+accountId+'.r2.cloudflarestorage.com'])assert.throws(()=>new R2Storage({...settings,endpoint}),/endpoint/);
  const storage=new R2Storage(settings);for(const key of ['other/file.mp4','pvr/../secrets.mp4','pvr/project/video.exe'])assert.throws(()=>storage.reference('r2:'+Buffer.from(key).toString('base64url')),/reference/);
  assert.equal((await new R2Storage({accountId:'',accessKeyId:'',secretAccessKey:'',bucket:''}).status()).configured,false);
});
