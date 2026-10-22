import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer,root} from './helpers.mjs';

const dir=mkdtempSync(path.join(tmpdir(),'pvr-navigation-')),server=await startServer(dir);
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
const errors=[];
try{
  const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await context.request.post(server.base+'/api/setup',{data:{name:'Anna',password:'review'}});await page.goto(server.base);await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  async function draw(x,y){
    const pencil=page.getByRole('button',{name:'Pencil',exact:true});if(!await pencil.evaluate(el=>el.classList.contains('selected')))await pencil.click();
    const box=await page.locator('.video-overlay').boundingBox();await page.mouse.move(box.x+box.width*x,box.y+box.height*y);await page.mouse.down();await page.mouse.move(box.x+box.width*(x+.1),box.y+box.height*(y+.1),{steps:10});await page.mouse.up();await page.locator('.drawing-editor').waitFor();
  }
  await draw(.1,.1);await page.getByLabel('Drawing explanation',{exact:true}).fill('Drawing on frame zero');await page.locator('.drawing-editor').getByRole('button',{name:'Accept drawing',exact:true}).click();await page.getByRole('button',{name:'Drawing on frame zero',exact:true}).waitFor();
  await draw(.7,.7);await page.getByLabel('Drawing explanation',{exact:true}).fill('Unfinished drawing stays in history');assert.equal(await page.locator('.video-overlay polyline').count(),2);
  // Freeze the decoder at the annotated frame while the user drags elsewhere.
  await page.locator('video').evaluate(el=>{const property=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');Object.defineProperty(el,'currentTime',{configurable:true,get(){return property.get.call(this);},set(value){this._heldSeek=value;}});});
  const timeline=await page.getByLabel('Video timeline').boundingBox();await page.mouse.move(timeline.x+timeline.width*.02,timeline.y+timeline.height/2);await page.mouse.down();
  await page.mouse.move(timeline.x+timeline.width*.8,timeline.y+timeline.height/2,{steps:20});
  assert.equal(await page.locator('video').evaluate(el=>el.currentTime),0);assert.ok(Number(await page.getByLabel('Video timeline').inputValue())>5);
  assert.equal(await page.locator('.video-overlay polyline,.drawing-hotspot,.drawing-editor,.saved-drawing').count(),0,'Drawings and popups must disappear before the decoder catches up');
  assert.equal(await page.locator('article.drawing-draft').count(),1);assert.equal(await page.locator('.drawing-preview').count(),1);
  await page.mouse.up();await page.locator('video').evaluate(el=>{const target=el._heldSeek;delete el.currentTime;el.currentTime=target;});
  await page.waitForFunction(()=>!document.querySelector('video').seeking&&document.querySelector('video').currentTime>5);
  assert.equal(await page.locator('.video-overlay polyline,.drawing-hotspot').count(),0);
  await page.locator('.drawing-draft .timestamp').click();await page.getByLabel('Drawing explanation',{exact:true}).waitFor();assert.equal(await page.getByLabel('Drawing explanation',{exact:true}).inputValue(),'Unfinished drawing stays in history');
  await page.locator('.drawing-editor').getByRole('button',{name:'Delete',exact:true}).click();
  await page.getByLabel('Video timeline').press('ArrowRight');await page.waitForFunction(()=>!document.querySelector('video').seeking&&document.querySelector('video').currentTime>.02);
  assert.equal(await page.locator('.video-overlay polyline,.drawing-hotspot').count(),0,'A drawing belongs only to its own frame');
  await page.getByRole('button',{name:'Go to comment at 00:00.000',exact:true}).click();await page.locator('.saved-drawing').waitFor();assert.equal(await page.locator('.video-overlay polyline').count(),1);
  console.log('PASS: saved and draft drawings hide immediately while scrubbing with a frozen decoder; frame stepping hides them; timestamps restore the right drawing');
  const link=await (await context.request.post(server.base+'/api/assets/demo/share')).json();
  await page.getByLabel('Review status').selectOption('Approved');
  // Use a real HTML drag to the destination project, rather than a mocked move response.
  const card=page.locator('.asset-card'),target=page.locator('[data-project-id="guides"]');
  await card.dragTo(target);await page.getByText('Video moved to Installation guides. Feedback and share links kept.',{exact:true}).waitFor();await page.getByRole('heading',{name:'Your next review starts here'}).waitFor();
  let projects=await (await context.request.get(server.base+'/api/projects')).json();assert.equal(projects.find(p=>p.id==='launch').asset_count,0);assert.equal(projects.find(p=>p.id==='guides').asset_count,1);
  const guest=await browser.newContext(),client=await guest.newPage();await client.goto(server.base+'/?review='+link.token);await client.getByRole('heading',{name:'Installation guides',exact:true}).waitFor();await client.getByRole('button',{name:'Drawing on frame zero',exact:true}).click();await client.locator('.saved-drawing p').filter({hasText:'Drawing on frame zero'}).waitFor();assert.equal(await client.getByLabel('Review status').inputValue(),'Approved');assert.equal(await client.getByRole('group',{name:'Video actions'}).count(),0);await guest.close();
  await target.click();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await page.getByRole('button',{name:'Drawing on frame zero',exact:true}).click();
  const actions=page.getByRole('group',{name:'Video actions'});for(const title of ['Upload video','Move video','Delete video']){const action=await actions.getByRole('button',{name:title,exact:true}).boundingBox(),stage=await page.locator('.video-stage').boundingBox();assert.ok(action.y+action.height<=stage.y);}
  assert.equal(await page.locator('.topbar').getByRole('button',{name:'Upload video',exact:true}).count(),0);assert.equal(await page.locator('.asset-delete').count(),0);
  mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/video-actions.png'),fullPage:true});
  // The accessible Move dialog also works on mobile and preserves the source on cancellation/failure.
  await page.setViewportSize({width:390,height:844});await actions.getByRole('button',{name:'Move video',exact:true}).click();await page.getByLabel('Destination project').selectOption('launch');await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('.asset-card').count(),1);
  await actions.getByRole('button',{name:'Move video',exact:true}).click();
  await page.route('**/api/assets/demo/move',route=>route.fulfill({status:503,json:{error:'Temporary move failure'}}));await page.getByRole('dialog').getByRole('button',{name:'Move video',exact:true}).click();await page.getByRole('alert').filter({hasText:'Temporary move failure'}).waitFor();assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.locator('.asset-card').count(),1);await page.unroute('**/api/assets/demo/move');
  await page.getByRole('dialog').getByRole('button',{name:'Move video',exact:true}).click();await page.getByRole('heading',{name:'Your next review starts here'}).waitFor();
  await page.getByLabel('Choose project',{exact:true}).selectOption('launch');await page.getByRole('button',{name:'Drawing on frame zero',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.setViewportSize({width:1366,height:768});await page.reload();await page.getByRole('button',{name:'Drawing on frame zero',exact:true}).waitFor();assert.equal(await page.getByLabel('Review status').inputValue(),'Approved');
  // Moving an unselected video preserves the selected video's unfinished feedback.
  const second=await context.request.post(server.base+'/api/projects/launch/assets',{multipart:{video:{name:'Second.mp4',mimeType:'video/mp4',buffer:readFileSync(path.join(root,'public/demo.mp4'))}}});assert.equal(second.status(),201);
  await page.reload();await page.locator('.asset-card').filter({hasText:'Second.mp4'}).waitFor();
  await page.getByLabel('Comment',{exact:true}).fill('Keep my unfinished comment');
  await page.locator('.asset-card').filter({hasText:'Second.mp4'}).dragTo(page.locator('[data-project-id="guides"]'));await page.getByText('Video moved to Installation guides. Feedback and share links kept.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Comment',{exact:true}).inputValue(),'Keep my unfinished comment');assert.equal(await page.locator('.asset-card').count(),1);
  // Moving a selected video with an unfinished draft can be canceled without losing the draft.
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('.asset-card').dragTo(page.locator('[data-project-id="guides"]'));assert.equal(await page.getByLabel('Comment',{exact:true}).inputValue(),'Keep my unfinished comment');assert.equal(await page.locator('.asset-card').count(),1);
  assert.deepEqual(errors,[]);console.log('PASS: real drag across projects, guest link/feedback/approval retention, controls above video, mobile Move dialog, cancel/failure/dirty-draft protection and reload');
}finally{await browser.close();await server.stop();rmSync(dir,{recursive:true,force:true});}
