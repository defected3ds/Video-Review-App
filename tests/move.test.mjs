import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startServer,root} from './helpers.mjs';

test('Moving a video preserves its media, feedback and guest links and only changes project membership',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pvr-move-'));let server=await startServer(dir),cookie='';
  const request=(route,method='GET',body,auth=true)=>fetch(server.base+route,{method,headers:{...(auth&&cookie?{cookie}:{}),...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  try{
    const setup=await request('/api/setup','POST',{name:'Move reviewer',password:'review'});cookie=setup.headers.get('set-cookie').split(';')[0];
    const bytes=readFileSync(path.join(root,'public/demo.mp4')),data=new FormData();data.append('video',new Blob([bytes]),'Original.mp4');
    const asset=await (await request('/api/projects/launch/assets','POST',data)).json();
    const feedback={author:'Anna',body:'Keep this drawing and pin',time:2,annotations:[{color:'#ec4047',points:[{x:.2,y:.3},{x:.4,y:.5}]}],hotspot:{x:.5,y:.5}};
    const comment=await (await request(`/api/assets/${asset.id}/comments`,'POST',feedback)).json();
    await request(`/api/assets/${asset.id}/comments/${comment.id}`,'PATCH',{resolved:true});await request(`/api/assets/${asset.id}`,'PATCH',{status:'Approved'});
    const share=await (await request(`/api/assets/${asset.id}/share`,'POST')).json(),guest=`/api/reviews/${share.token}`;
    assert.equal((await request(`/api/assets/${asset.id}/move`,'POST',{projectId:'guides'},false)).status,401);
    assert.equal((await request(guest+'/move','POST',{projectId:'guides'},false)).status,404);
    for(const body of [{},{projectId:42},{projectId:''},{projectId:'x'.repeat(101)}])assert.equal((await request(`/api/assets/${asset.id}/move`,'POST',body)).status,400);
    assert.equal((await request(`/api/assets/${asset.id}/move`,'POST',{projectId:'missing'})).status,404);
    const db=new DatabaseSync(path.join(dir,'review.sqlite')),before=db.prepare('SELECT * FROM assets WHERE id=?').get(asset.id),files=readdirSync(path.join(dir,'uploads'));
    const moved=await request(`/api/assets/${asset.id}/move`,'POST',{projectId:'guides'});assert.equal(moved.status,200);assert.equal((await moved.json()).project_id,'guides');
    assert.deepEqual({...db.prepare('SELECT * FROM assets WHERE id=?').get(asset.id)},{...before,project_id:'guides'});db.close();
    assert.deepEqual(readdirSync(path.join(dir,'uploads')),files);assert.deepEqual(readFileSync(path.join(dir,'uploads',before.filename)),bytes);
    const shared=await (await request(guest,'GET',null,false)).json();assert.equal(shared.project.id,'guides');assert.equal(shared.asset.status,'Approved');
    const comments=await (await request(guest+'/comments','GET',null,false)).json();assert.equal(comments.length,1);assert.deepEqual(comments[0],{...comment,resolved:true});
    assert.equal((await request(`/api/assets/${asset.id}/move`,'POST',{projectId:'guides'})).status,200);
    const projects=await (await request('/api/projects')).json();assert.equal(projects.find(p=>p.id==='launch').asset_count,1);assert.equal(projects.find(p=>p.id==='guides').asset_count,1);
    const destination=await (await request('/api/projects','POST',{name:'Final destination'})).json();
    assert.equal((await request(`/api/assets/${asset.id}/move`,'POST',{projectId:destination.id})).status,200);
    assert.deepEqual(await (await request('/api/projects/guides/assets')).json(),[]);
    await server.stop();server=await startServer(dir);
    assert.equal((await (await request(guest,'GET',null,false)).json()).project.id,destination.id);
    await request('/api/projects/guides','DELETE');await request('/api/projects/launch','DELETE');
    assert.equal((await request(guest+'/video','GET',null,false)).status,200);assert.equal((await (await request(guest+'/comments','GET',null,false)).json()).length,1);
  }finally{await server.stop();rmSync(dir,{recursive:true,force:true});}
});
