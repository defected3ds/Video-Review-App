import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.mjs';

test('Nickname profiles use the shared password, persist across sessions, and stay private', async () => {
  const dir=mkdtempSync(path.join(tmpdir(),'pvr-profiles-'));
  let server=await startServer(dir);
  const request=(route,method='GET',body,cookie='')=>fetch(server.base+route,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const cookieOf=response=>response.headers.get('set-cookie').split(';')[0];
  try{
    const setup=await request('/api/setup','POST',{name:'Owner',password:'shared-password'}),ownerCookie=cookieOf(setup),owner=await setup.json();
    assert.ok(owner.profileId);
    assert.equal((await request('/api/people')).status,401);
    assert.equal((await request('/api/login','POST',{nickname:'Intruder',password:'incorrect'})).status,401);
    assert.equal((await (await request('/api/people','GET',null,ownerCookie)).json()).length,1);
    for(const nickname of ['','  ','x'.repeat(81)])assert.equal((await request('/api/login','POST',{nickname,password:'shared-password'})).status,400);
    const first=await request('/api/login','POST',{nickname:'  Anna  ',password:'shared-password'}),annaCookie=cookieOf(first),anna=await first.json();
    assert.equal(anna.name,'Anna');assert.notEqual(anna.profileId,owner.profileId);
    const again=await (await request('/api/login','POST',{nickname:'ANNA',password:'shared-password'})).json();
    assert.equal(again.profileId,anna.profileId);assert.equal(again.name,'Anna');
    assert.equal((await request('/api/settings/profile','PATCH',{name:'owner'},annaCookie)).status,409);
    assert.equal((await request('/api/settings/profile','PATCH',{name:'Anna Client'},annaCookie)).status,200);
    assert.equal((await (await request('/api/session','GET',null,ownerCookie)).json()).name,'Owner');
    const invitation=await (await request('/api/assets/demo/share','POST',{},ownerCookie)).json();
    assert.equal((await request('/api/people?review='+invitation.token)).status,401);
    const people=await (await request('/api/people','GET',null,ownerCookie)).json();assert.equal(people.length,2);
    assert.ok(people.every(p=>Object.keys(p).sort().join(',')==='created_at,id,last_seen_at,nickname'));
    await server.stop();server=await startServer(dir);
    const persisted=await (await request('/api/session','GET',null,annaCookie)).json();assert.equal(persisted.name,'Anna Client');assert.equal(persisted.profileId,anna.profileId);
    const returning=await (await request('/api/login','POST',{nickname:'Anna Client',password:'shared-password'})).json();assert.equal(returning.profileId,anna.profileId);
    await request('/api/logout','POST',null,annaCookie);assert.equal((await (await request('/api/session','GET',null,annaCookie)).json()).authenticated,false);
  }finally{await server.stop();rmSync(dir,{recursive:true,force:true});}
});
