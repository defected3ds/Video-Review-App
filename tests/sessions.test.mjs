import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startServer} from './helpers.mjs';

test('Workspace and scoped review sessions require the password, expire after one hour, and cannot bypass each other',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pvr-hour-'));let server=await startServer(dir);
  const request=(route,method='GET',body,cookie='')=>fetch(server.base+route,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const cookieOf=response=>response.headers.get('set-cookie').split(';')[0];
  try{
    const setup=await request('/api/setup','POST',{name:'Owner',password:'shared-password'}),ownerCookie=cookieOf(setup),data=await setup.json();assert.equal(setup.status,201);
    assert.match(setup.headers.get('set-cookie'),/Max-Age=3600;/);assert.equal(data.expiresAt-data.serverTime<=3600000,true);assert.ok(data.expiresAt-data.serverTime>3598000);
    const first=await (await request('/api/assets/demo/share','POST',null,ownerCookie)).json(),second=await (await request('/api/assets/demo/share','POST',null,ownerCookie)).json();
    const base='/api/reviews/'+first.token,other='/api/reviews/'+second.token;
    assert.equal((await (await request(base+'/session')).json()).authenticated,false);
    for(const tail of ['','/video','/poster','/comments','/playback-status'])assert.equal((await request(base+tail)).status,401);
    assert.equal((await request(base+'/comments','POST',{author:'A',body:'Bypass',time:1})).status,401);
    assert.equal((await request(base+'/status','PATCH',{status:'Approved'})).status,401);
    assert.equal((await request(base+'/login','POST',{password:'wrong'})).status,401);
    const login=await request(base+'/login','POST',{password:'shared-password'}),guestCookie=cookieOf(login),session=await login.json();assert.equal(login.status,200);
    assert.match(login.headers.get('set-cookie'),/Max-Age=3600;/);assert.ok(login.headers.get('set-cookie').includes(`Path=${base}`));assert.match(login.headers.get('set-cookie'),/HttpOnly/);
    assert.ok(session.expiresAt-session.serverTime<=3600000&&session.expiresAt-session.serverTime>3598000);
    assert.equal((await request(base,'GET',null,guestCookie)).status,200);assert.equal((await request(base+'/video','GET',null,guestCookie)).status,200);
    for(const route of ['/api/projects','/api/people','/api/assets/demo',other,other+'/comments'])assert.equal((await request(route,'GET',null,guestCookie)).status,401);
    assert.equal((await request('/api/settings/profile','PATCH',{name:'Bypass'},guestCookie)).status,401);
    const before=await (await request(base+'/session','GET',null,guestCookie)).json();await request(base+'/comments','GET',null,guestCookie);const after=await (await request(base+'/session','GET',null,guestCookie)).json();assert.equal(after.expiresAt,before.expiresAt,'Activity must not extend the one-hour deadline');
    const db=new DatabaseSync(path.join(dir,'review.sqlite'));db.prepare('UPDATE sessions SET expires_at=?').run(Date.now()-1);db.close();
    assert.equal((await request('/api/projects','GET',null,ownerCookie)).status,401);assert.equal((await request(base+'/comments','GET',null,guestCookie)).status,401);
    assert.equal((await (await request(base+'/session','GET',null,guestCookie)).json()).authenticated,false);
    const again=await request(base+'/login','POST',{password:'shared-password'},guestCookie),newCookie=cookieOf(again);assert.equal(again.status,200);assert.notEqual(newCookie,guestCookie);assert.equal((await request(base,'GET',null,guestCookie)).status,401);assert.equal((await request(base,'GET',null,newCookie)).status,200);
    const ownerLogin=await request('/api/login','POST',{password:'shared-password'});assert.equal(ownerLogin.status,200);assert.match(ownerLogin.headers.get('set-cookie'),/Max-Age=3600;/);
    const newOwnerCookie=cookieOf(ownerLogin),ownerSession=await (await request('/api/session','GET',null,newOwnerCookie)).json();assert.ok(ownerSession.expiresAt-Date.now()<=3600000);
    // Older seven-day database rows are capped at startup, never extended by restart/activity.
    const legacy=new DatabaseSync(path.join(dir,'review.sqlite'));legacy.prepare('UPDATE sessions SET expires_at=? WHERE token NOT LIKE ?').run(Date.now()+7*86400000,'review:%');legacy.close();
    await server.stop();const boot=Date.now();server=await startServer(dir);const capped=await (await request('/api/session','GET',null,newOwnerCookie)).json();assert.ok(capped.expiresAt<=boot+3601000);
    await server.stop();server=await startServer(dir);assert.equal((await (await request('/api/session','GET',null,newOwnerCookie)).json()).expiresAt,capped.expiresAt);
    assert.equal((await request(base+'/logout','POST',null,newCookie)).status,204);assert.equal((await request(base,'GET',null,newCookie)).status,401);
  }finally{await server.stop();rmSync(dir,{recursive:true,force:true});}
});
