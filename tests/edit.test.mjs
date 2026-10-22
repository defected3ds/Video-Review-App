import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer,root} from './helpers.mjs';

test('Feedback edits preserve identity and timestamp; scoped guests can edit only with their own per-comment capability',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pvr-edit-'));let server=await startServer(dir),ownerCookie;
  const request=(route,method='GET',body,cookie=ownerCookie)=>fetch(server.base+route,{method,headers:{...(cookie?{cookie}:{}),...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  const cookieOf=response=>response.headers.get('set-cookie').split(';')[0];
  try{
    const setup=await request('/api/setup','POST',{name:'Owner',password:'review'},'');ownerCookie=cookieOf(setup);
    const data=new FormData();data.append('video',new Blob([readFileSync(path.join(root,'public/demo.mp4'))]),'Other.mp4');const other=await (await request('/api/projects/launch/assets','POST',data)).json();
    const initial={author:'Anna',body:'Original pin',time:2,hotspot:{x:.4,y:.5},annotations:[{color:'#ec4047',points:[{x:.1,y:.1},{x:.2,y:.2}]}]};
    const original=await (await request('/api/assets/demo/comments','POST',initial)).json();assert.match(original.editToken,/^[a-f0-9]{64}$/);
    const updated=await request(`/api/assets/demo/comments/${original.id}`,'PATCH',{body:'Updated explanation',annotations:[...initial.annotations,{color:'#009fe3',points:[{x:.6,y:.7}]}],hotspot:{x:.6,y:.4},time:6,author:'Changed author'});assert.equal(updated.status,200);const saved=await updated.json();
    assert.equal(saved.id,original.id);assert.equal(saved.time,2);assert.equal(saved.frame,50);assert.equal(saved.author,'Anna');assert.equal(saved.created_at,original.created_at);assert.equal(saved.annotations.length,2);assert.equal(saved.hotspot.x,.6);
    assert.equal((await request(`/api/assets/${other.id}/comments/${original.id}`,'PATCH',{body:'Wrong video'})).status,404);
    const link=await (await request('/api/assets/demo/share','POST')).json(),base='/api/reviews/'+link.token;
    const login=await request(base+'/login','POST',{password:'review'},''),guestCookie=cookieOf(login);
    assert.equal((await request(base+'/comments/'+original.id,'PATCH',{body:'Guest overwrite'},guestCookie)).status,403);
    const own=await (await request(base+'/comments','POST',{author:'Client',body:'My drawing',time:3,annotations:initial.annotations},guestCookie)).json();assert.ok(own.editToken);
    assert.equal((await request(base+'/comments/'+original.id,'PATCH',{body:'Wrong capability',editToken:own.editToken},guestCookie)).status,403);
    assert.equal((await request(base+'/comments/'+own.id,'PATCH',{body:'No session',editToken:own.editToken},'')).status,401);
    for(const body of [{body:''},{body:'x'.repeat(4001)},{body:'Bad path',annotations:[{color:'#ec4047',points:[{x:2,y:0}]}]}])assert.equal((await request(base+'/comments/'+own.id,'PATCH',{...body,editToken:own.editToken},guestCookie)).status,400);
    const ownEdit=await request(base+'/comments/'+own.id,'PATCH',{body:'My edited drawing',annotations:initial.annotations,editToken:own.editToken},guestCookie);assert.equal(ownEdit.status,200);assert.equal((await ownEdit.json()).time,3);
    const listed=await (await request(base+'/comments','GET',null,guestCookie)).json();assert.ok(listed.every(c=>!('editToken' in c)));assert.ok(!JSON.stringify(listed).includes(own.editToken));
    await server.stop();server=await startServer(dir);
    assert.equal((await request(base+'/comments/'+own.id,'PATCH',{body:'After restart',editToken:own.editToken},guestCookie)).status,200);
    const changed=await request('/api/settings/password','POST',{currentPassword:'review',newPassword:'newpass'});ownerCookie=cookieOf(changed);
    assert.equal((await request(base+'/comments/'+own.id,'PATCH',{body:'Expired sign-in',editToken:own.editToken},guestCookie)).status,401);
    const relogin=await request(base+'/login','POST',{password:'newpass'},''),renewed=cookieOf(relogin);
    assert.equal((await request(base+'/comments/'+own.id,'PATCH',{body:'After password change',editToken:own.editToken},renewed)).status,200);
    const final=await (await request(base+'/comments','GET',null,renewed)).json();assert.equal(final.find(c=>c.id===own.id).body,'After password change');assert.equal(final.find(c=>c.id===own.id).time,3);
  }finally{await server.stop();rmSync(dir,{recursive:true,force:true});}
});
