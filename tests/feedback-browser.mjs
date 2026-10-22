import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer,root} from './helpers.mjs';

const dir=mkdtempSync(path.join(tmpdir(),'pvr-feedback-')),server=await startServer(dir);
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
const errors=[],bytes=readFileSync(path.join(root,'public/demo.mp4'));
try{
  const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await context.request.post(server.base+'/api/setup',{data:{name:'Anna',password:'review'}});
  await page.goto(server.base);await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  async function draw(x=.1,y=.1){await page.locator('.video-stage').scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const a=document.querySelector('.video-overlay').getBoundingClientRect(),b=document.querySelector('.video-stage').getBoundingClientRect();return a.width<=b.width+1&&a.height<=b.height+1;});const box=await page.locator('.video-overlay').boundingBox();await page.mouse.move(box.x+box.width*x,box.y+box.height*y);await page.mouse.down();await page.mouse.move(box.x+box.width*(x+.12),box.y+box.height*(y+.12),{steps:10});await page.mouse.up();try{await page.locator('.drawing-editor').waitFor({timeout:5000});}catch(e){await page.screenshot({path:path.join(root,'test-results/drawing-failure.png'),fullPage:true});console.log(await page.evaluate(()=>({tool:document.querySelector('.video-overlay').className,drafts:document.querySelectorAll('.drawing-draft').length,time:document.querySelector('video').currentTime,overlay:document.querySelector('.video-overlay').getBoundingClientRect().toJSON(),stage:document.querySelector('.video-stage').getBoundingClientRect().toJSON(),popup:document.querySelector('.drawing-editor')?.outerHTML})));throw e;}}
  const editor=page.locator('.drawing-editor'),drafts=page.locator('article.drawing-draft');
  await page.getByLabel('Video timeline').press('Home');await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await draw();await page.getByLabel('Drawing explanation',{exact:true}).fill('First independent drawing');
  assert.equal(await drafts.first().getByLabel('Draft drawing explanation').inputValue(),'First independent drawing');
  await page.getByRole('button',{name:'Add emoji to drawing',exact:true}).click();await page.getByRole('button',{name:'Insert Thumbs up emoji',exact:true}).click();
  assert.equal(await drafts.first().getByLabel('Draft drawing explanation').inputValue(),'First independent drawing👍');
  await page.getByRole('button',{name:'Close drawing editor',exact:true}).click();
  await draw(.6,.65);await page.getByLabel('Drawing explanation',{exact:true}).fill('Second independent drawing');
  assert.equal(await drafts.count(),2);assert.equal(await page.locator('.drawing-draft-marker span').innerText(),'2');
  // Text feedback must never silently accept any drawing drafts.
  await page.getByLabel('Comment',{exact:true}).fill('Text feedback is independent');await page.getByRole('button',{name:'Send comment',exact:true}).click();
  await page.getByRole('button',{name:'Text feedback is independent',exact:true}).waitFor();assert.equal(await drafts.count(),2);assert.equal(await page.locator('.drawing-preview').count(),0);
  await drafts.first().getByRole('button',{name:/00:00/}).click();
  // A failed accept preserves only that draft and its explanation.
  await page.route('**/api/assets/demo/comments',async route=>{if(route.request().method()==='POST')await route.fulfill({status:503,json:{error:'Temporary feedback outage'}});else await route.continue();});
  await editor.getByRole('button',{name:'Accept drawing',exact:true}).click();await page.getByRole('alert').filter({hasText:'Temporary feedback outage'}).waitFor();assert.equal(await drafts.count(),2);
  assert.equal(await page.getByLabel('Drawing explanation',{exact:true}).inputValue(),'First independent drawing👍');await page.unroute('**/api/assets/demo/comments');
  let acceptRequests=0;
  await page.route('**/api/assets/demo/comments',async route=>{if(route.request().method()==='POST'){acceptRequests++;await new Promise(resolve=>setTimeout(resolve,100));}await route.continue();});
  await editor.locator('button.primary').evaluate(button=>{button.click();button.click();});await page.getByRole('button',{name:'First independent drawing👍',exact:true}).waitFor();
  assert.equal(acceptRequests,1);await page.unroute('**/api/assets/demo/comments');
  assert.equal(await drafts.count(),1);assert.equal(await page.locator('.drawing-preview').count(),1);assert.equal(await page.locator('.saved-drawing p').innerText(),'First independent drawing👍');
  // Another frame can hold a separate drawing while a previous frame still has a draft.
  await page.getByLabel('Video timeline').press('End');await page.getByRole('button',{name:'Pencil',exact:true}).click();
  // Pencil stays active after accept, so toggle back on only if needed.
  if(!await page.getByRole('button',{name:'Pencil',exact:true}).evaluate(el=>el.classList.contains('selected')))await page.getByRole('button',{name:'Pencil',exact:true}).click();
  await draw(.15,.1);await page.getByLabel('Drawing explanation',{exact:true}).fill('At the end of the video');assert.equal(await drafts.count(),2);
  await editor.getByRole('button',{name:'Delete',exact:true}).click();assert.equal(await drafts.count(),1);assert.equal(await page.locator('.drawing-preview').count(),1);
  await drafts.first().getByLabel('Draft drawing explanation').fill('Sidebar explanation matches');
  assert.equal(await page.getByLabel('Drawing explanation',{exact:true}).inputValue(),'Sidebar explanation matches');
  await drafts.first().getByRole('button',{name:'Accept drawing',exact:true}).click();await page.getByRole('button',{name:'Sidebar explanation matches',exact:true}).waitFor();
  assert.equal(await drafts.count(),0);assert.equal(await page.locator('.drawing-preview').count(),2);
  let rows=await (await context.request.get(server.base+'/api/assets/demo/comments')).json();const drawings=rows.filter(c=>c.annotations.length);assert.equal(drawings.length,2);assert.equal(drawings[0].time,drawings[1].time);assert.ok(drawings.every(c=>c.annotations.length===1&&!c.hotspot));
  await page.reload();await page.getByRole('button',{name:'First independent drawing👍',exact:true}).click();await page.locator('.saved-drawing p').filter({hasText:'First independent drawing👍'}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Pencil',exact:true}).click();await draw(.35,.65);
  const popup=await editor.boundingBox(),video=await page.locator('.video-overlay').boundingBox();assert.ok(popup.x>=video.x&&popup.x+popup.width<=video.x+video.width+1);assert.ok(popup.y>=video.y&&popup.y+popup.height<=video.y+video.height+1);
  await editor.getByRole('button',{name:'Delete',exact:true}).click();await page.setViewportSize({width:1366,height:768});
  mkdirSync(path.join(root,'test-results'),{recursive:true});await page.getByRole('button',{name:'First independent drawing👍',exact:true}).click();await page.screenshot({path:path.join(root,'test-results/drawing-feedback.png'),fullPage:true});
  console.log('PASS: independent strokes at the same/different frames, mirrored explanations, emoji, accept/delete, failure recovery, persisted popup and mobile bounds');
  // Guest shared links show the accepted explanation and allow their own drawings.
  const share=await (await context.request.post(server.base+'/api/assets/demo/share')).json(),guest=await browser.newContext(),client=await guest.newPage();
  await client.goto(server.base+'/?review='+share.token);await client.getByRole('button',{name:'First independent drawing👍',exact:true}).click();await client.locator('.saved-drawing p').filter({hasText:'First independent drawing👍'}).waitFor();
  assert.equal(await client.getByRole('button',{name:/Delete video/}).count(),0);await guest.close();
  // Drop target and file picker use the same upload path and reject invalid/multiple files.
  await page.getByRole('button',{name:'New project',exact:true}).click();await page.getByLabel('Project name').fill('Drag and drop');await page.getByRole('button',{name:'Create project',exact:true}).click();await page.getByRole('heading',{name:'Your next review starts here'}).waitFor();
  const project=(await (await context.request.get(server.base+'/api/projects')).json()).find(p=>p.name==='Drag and drop');
  async function drop(files){const transfer=await page.evaluateHandle(files=>{const data=new DataTransfer();for(const file of files)data.items.add(new File([new Uint8Array(file.bytes)],file.name,{type:file.type||'video/mp4'}));return data;},files);await page.locator('.workspace').dispatchEvent('dragenter',{dataTransfer:transfer});await page.getByText('Drop video to upload',{exact:true}).waitFor();await page.locator('.workspace').dispatchEvent('dragover',{dataTransfer:transfer});await page.locator('.workspace').dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();}
  await drop([{name:'invalid.txt',bytes:[1,2,3]}]);await page.getByRole('alert').filter({hasText:'Choose an MP4 or WebM'}).waitFor();assert.equal((await (await context.request.get(server.base+`/api/projects/${project.id}/assets`)).json()).length,0);
  await drop([{name:'one.mp4',bytes:[1]},{name:'two.mp4',bytes:[2]}]);await page.getByRole('alert').filter({hasText:'Drop one video at a time.'}).waitFor();
  await drop([{name:'Dropped original.mp4',bytes:[...bytes]}]);await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await page.locator('.asset-card').filter({hasText:'Dropped original.mp4'}).waitFor();
  await page.getByLabel('Upload video file').setInputFiles({name:'Picked original.mp4',mimeType:'video/mp4',buffer:bytes});await page.locator('.asset-card').filter({hasText:'Picked original.mp4'}).waitFor();assert.equal(await page.locator('.asset-card').count(),2);
  const uploaded=await (await context.request.get(server.base+`/api/projects/${project.id}/assets`)).json();assert.ok(uploaded.every(a=>a.size===bytes.length));
  // Video management actions belong above the player; deleting only affects the selected video.
  const actions=page.getByRole('group',{name:'Video actions'}),actionsBox=await actions.boundingBox(),stageBox=await page.locator('.video-stage').boundingBox();
  assert.ok(actionsBox.y+actionsBox.height<=stageBox.y);assert.equal(await page.locator('.topbar').getByRole('button',{name:'Upload video',exact:true}).count(),0);
  await page.locator('.asset-card').filter({hasText:'Dropped original.mp4'}).click();
  await page.getByLabel('Comment',{exact:true}).fill('Keep this unfinished feedback when canceling');await actions.getByRole('button',{name:'Delete video',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('.asset-card').count(),2);
  assert.equal(await page.getByLabel('Comment',{exact:true}).inputValue(),'Keep this unfinished feedback when canceling');
  await actions.getByRole('button',{name:'Delete video',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Delete video',exact:true}).click();await page.getByText('Video and its review data deleted. Project kept.',{exact:true}).waitFor();assert.equal(await page.locator('.asset-card').count(),1);
  await actions.getByRole('button',{name:'Delete video',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Delete video',exact:true}).click();await page.getByRole('heading',{name:'Your next review starts here'}).waitFor();await page.getByRole('heading',{name:'Drag and drop',exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:/Drag and drop/}).click();await page.getByRole('heading',{name:'Your next review starts here'}).waitFor();
  await drop([{name:'Replacement.mp4',bytes:[...bytes]}]);await page.locator('.asset-card').filter({hasText:'Replacement.mp4'}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS: drag/drop validation and upload, original byte sizes, cancel/single/last-video deletion, preserved project and canceled draft, re-upload into empty project');
}finally{await browser.close();await server.stop();rmSync(dir,{recursive:true,force:true});}
