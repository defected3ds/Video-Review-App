import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, root ,createReviewGuest} from './helpers.mjs';

test('Persistent video review workflow and guest access boundaries',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pipelife-api-'));
  let server=await startServer(dir),cookie='',uploaded,comment,invitation;
  const guestHeaders=createReviewGuest(()=>server.base);
  const request=async(route,method='GET',body,authenticated=true,headers={})=>fetch(server.base+route,{method,headers:{...(authenticated&&cookie?{cookie}:!authenticated?await guestHeaders(route):{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  try {
    await t.test('workspace requires authentication; setup creates a persistent session',async()=>{
      assert.equal((await request('/api/projects', 'GET',null,false)).status,401);
      assert.equal((await request('/api/session')).status,200);
      assert.equal((await request('/api/setup','POST',{name:'Test reviewer',password:'short'})).status,400);
      const response=await request('/api/setup','POST',{name:'Test reviewer',password:'review'});
      assert.equal(response.status,201);cookie=response.headers.get('set-cookie').split(';')[0];
      assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));
      assert.equal((await request('/api/setup','POST',{name:'Other',password:'another-password'})).status,409);
      assert.equal((await request('/api/projects')).status,200);
      assert.equal((await request('/api/projects','POST',{name:'Injected'},true,{Origin:'https://evil.example'})).status,403);
    });
    await t.test('valid video uploads produce metadata, a thumbnail, and byte-range playback',async()=>{
      const form=new FormData();form.append('video',new Blob([readFileSync(path.join(root,'public/demo.mp4'))],{type:'video/mp4'}),'review-test.mp4');
      const response=await request('/api/projects/launch/assets','POST',form);assert.equal(response.status,201);uploaded=await response.json();
      assert.equal(uploaded.fps,25);assert.equal(uploaded.duration,8);assert.ok(uploaded.hasPoster);assert.equal(uploaded.filename,undefined);
      const video=await request(`/api/assets/${uploaded.id}/video`,'GET',null,true,{Range:'bytes=0-99'});
      assert.equal(video.status,206);assert.equal((await video.arrayBuffer()).byteLength,100);assert.match(video.headers.get('content-range'),/^bytes 0-99\//);
      const poster=await request(`/api/assets/${uploaded.id}/poster`);assert.equal(poster.status,200);assert.match(poster.headers.get('content-type'),/image\/jpeg/);
    });
    await t.test('forged video uploads and malformed feedback are rejected without orphan files',async()=>{
      const before=readdirSync(path.join(dir,'uploads')).length;
      const form=new FormData();form.append('video',new Blob(['not a video'],{type:'video/mp4'}),'fake.mp4');
      assert.equal((await request('/api/projects/launch/assets','POST',form)).status,400);
      assert.equal(readdirSync(path.join(dir,'uploads')).length,before);
      for(const body of [{body:'test',author:'A',time:-1},{body:'test',author:'A',time:9},{body:'',author:'A',time:1},{body:'test',author:'A',time:1,hotspot:{x:2,y:.5}}])assert.equal((await request(`/api/assets/${uploaded.id}/comments`,'POST',body)).status,400);
    });
    await t.test('comments retain normalized hotspots, pencil paths, and frame timestamps',async()=>{
      const value={body:'Please check this detail.',author:'Anna',time:2,hotspot:{x:.4,y:.6},annotations:[{color:'#ec4047',points:[{x:.2,y:.3},{x:.4,y:.5}]}]};
      const response=await request(`/api/assets/${uploaded.id}/comments`,'POST',value);assert.equal(response.status,201);comment=await response.json();
      assert.equal(comment.frame,50);assert.deepEqual(comment.hotspot,value.hotspot);assert.deepEqual(comment.annotations,value.annotations);
    });
    await t.test('review queue lists every project with status and feedback counts, and stays private',async()=>{
      assert.equal((await request('/api/reviews','GET',null,false)).status,401);
      const project=await (await request('/api/projects','POST',{name:'Queue project'})).json();
      const form=new FormData();form.append('video',new Blob([readFileSync(path.join(root,'public/demo.mp4'))],{type:'video/mp4'}),'Queue review.mp4');
      const queued=await (await request(`/api/projects/${project.id}/assets`,'POST',form)).json();
      await request(`/api/assets/${queued.id}`,'PATCH',{status:'Changes requested'});
      const rows=await (await request('/api/reviews')).json();
      assert.ok(rows.some(a=>a.id===uploaded.id&&a.comment_count===1));
      const item=rows.find(a=>a.id===queued.id);assert.equal(item.project_name,'Queue project');assert.equal(item.status,'Changes requested');assert.equal(item.filename,undefined);assert.equal(item.poster,undefined);
      await request(`/api/projects/${project.id}`,'DELETE');
      assert.ok(!(await (await request('/api/reviews')).json()).some(a=>a.id===queued.id));
    });
    await t.test('guest links grant access only to the selected review',async()=>{
      const response=await request(`/api/assets/${uploaded.id}/share`,'POST');assert.equal(response.status,201);invitation=await response.json();
      const guestBase=`/api/reviews/${invitation.token}`;
      const review=await (await request(guestBase,'GET',null,false)).json();assert.equal(review.asset.id,uploaded.id);
      assert.equal((await request(guestBase+'/video','GET',null,false,{Range:'bytes=0-20'})).status,206);
      assert.equal((await request('/api/projects','GET',null,false)).status,401);
      assert.equal((await request(`/api/assets/${uploaded.id}/comments`,'GET',null,false)).status,401);
      assert.equal((await request(guestBase+'/share','POST',{},false)).status,404);
      assert.equal((await request(guestBase+'/comments/'+comment.id,'PATCH',{resolved:true},false)).status,404);
      assert.equal((await request(guestBase+'/comments','POST',{body:'Looks good.',author:'Client',time:3},false)).status,201);
      assert.equal((await request(guestBase+'/status','PATCH',{status:'Approved'},false)).status,200);
    });
    await t.test('only the team can resolve feedback, with the comment scoped to its asset',async()=>{
      assert.equal((await request(`/api/assets/demo/comments/${comment.id}`,'PATCH',{resolved:true})).status,404);
      const response=await request(`/api/assets/${uploaded.id}/comments/${comment.id}`,'PATCH',{resolved:true});assert.equal(response.status,200);assert.equal((await response.json()).resolved,true);
    });
    await t.test('restart preserves uploads, sessions, comments, annotations, and approval status',async()=>{
      await server.stop();server=await startServer(dir);
      const asset=await (await request(`/api/assets/${uploaded.id}`)).json();assert.equal(asset.status,'Approved');
      const rows=await (await request(`/api/assets/${uploaded.id}/comments`)).json();assert.equal(rows.length,2);assert.deepEqual(rows.find(c=>c.id===comment.id).annotations,comment.annotations);assert.equal(rows.find(c=>c.id===comment.id).resolved,true);
      assert.equal((await request(`/api/assets/${uploaded.id}/video`)).status,200);
    });
    await t.test('deleting one video revokes its links and feedback, cleans local files, and preserves its project and sibling',async()=>{
      const before=readdirSync(path.join(dir,'uploads')).length;
      const form=new FormData();form.append('video',new Blob([readFileSync(path.join(root,'public/demo.mp4'))],{type:'video/mp4'}),'Disposable.mp4');
      const disposable=await (await request('/api/projects/launch/assets','POST',form)).json();
      const feedback=await (await request(`/api/assets/${disposable.id}/comments`,'POST',{author:'A',body:'Delete only me',time:1})).json();
      const link=await (await request(`/api/assets/${disposable.id}/share`,'POST')).json();
      assert.equal((await request(`/api/assets/${disposable.id}`,'DELETE',null,false)).status,401);
      assert.equal((await request(`/api/reviews/${link.token}`,'DELETE',null,false)).status,404);
      assert.equal((await request(`/api/assets/${disposable.id}`,'DELETE')).status,204);
      assert.equal(readdirSync(path.join(dir,'uploads')).length,before);
      assert.equal((await request(`/api/assets/${disposable.id}`)).status,404);
      assert.equal((await request(`/api/assets/${disposable.id}/comments/${feedback.id}`,'PATCH',{resolved:true})).status,404);
      assert.equal((await request(`/api/reviews/${link.token}`,'GET',null,false)).status,404);
      assert.equal((await request(`/api/assets/${uploaded.id}`)).status,200);
      assert.equal((await (await request(`/api/assets/${uploaded.id}/comments`)).json()).length,2);
      assert.equal((await request(`/api/reviews/${invitation.token}`,'GET',null,false)).status,200);
      const emptyProject=await (await request('/api/projects','POST',{name:'Keep empty project'})).json();
      const last=new FormData();last.append('video',new Blob([readFileSync(path.join(root,'public/demo.mp4'))]),'Last.mp4');
      const lastVideo=await (await request(`/api/projects/${emptyProject.id}/assets`,'POST',last)).json();
      assert.equal((await request(`/api/assets/${lastVideo.id}`,'DELETE')).status,204);
      await server.stop();server=await startServer(dir);
      assert.equal((await request(`/api/assets/${disposable.id}`)).status,404);
      assert.deepEqual(await (await request(`/api/projects/${emptyProject.id}/assets`)).json(),[]);
      assert.ok((await (await request('/api/projects')).json()).some(p=>p.id===emptyProject.id&&p.asset_count===0));
      await request(`/api/projects/${emptyProject.id}`,'DELETE');
    });
    await t.test('deleting a project removes its files and links, leaves other projects intact, and stays deleted after restart',async()=>{
      assert.equal((await request('/api/projects/launch','DELETE',null,false)).status,401);
      assert.equal((await request('/api/projects/launch','DELETE')).status,204);
      assert.equal((await request(`/api/assets/${uploaded.id}`)).status,404);
      assert.equal((await request(`/api/reviews/${invitation.token}`,'GET',null,false)).status,404);
      assert.equal(readdirSync(path.join(dir,'uploads')).length,0);
      assert.equal((await request('/api/projects/guides/assets')).status,200);
      assert.equal((await request('/api/projects/guides','DELETE')).status,204);
      await server.stop();server=await startServer(dir);
      assert.deepEqual(await (await request('/api/projects')).json(),[]);
      const project=await (await request('/api/projects','POST',{name:'After deletion'})).json();
      const form=new FormData();form.append('video',new Blob([readFileSync(path.join(root,'public/demo.mp4'))],{type:'video/mp4'}),'fresh.mp4');
      uploaded=await (await request(`/api/projects/${project.id}/assets`,'POST',form)).json();
      invitation=await (await request(`/api/assets/${uploaded.id}/share`,'POST')).json();
    });
    await t.test('revocation removes guest access to metadata, comments, and media',async()=>{
      assert.equal((await request(`/api/assets/${uploaded.id}/share`,'DELETE')).status,204);
      for(const tail of ['','/comments','/video'])assert.equal((await request(`/api/reviews/${invitation.token}${tail}`,'GET',null,false)).status,404);
      assert.equal((await request('/api/logout','POST')).status,204);assert.equal((await request('/api/projects')).status,401);
      const login=await request('/api/login','POST',{password:'review'},false);assert.equal(login.status,200);
    });
  }finally{await server.stop();rmSync(dir,{recursive:true,force:true});}
});
