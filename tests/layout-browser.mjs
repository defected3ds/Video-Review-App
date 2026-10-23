import{chromium}from'playwright';
import assert from'node:assert/strict';
import{mkdtempSync,mkdirSync,existsSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';import path from'node:path';
import{startServer,root}from'./helpers.mjs';
const dir=mkdtempSync(path.join(tmpdir(),'pvr-sidebar-')),server=await startServer(dir);
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
const errors=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.request.post(server.base+'/api/setup',{data:{name:'Anna',password:'review'}});
 const existing=await(await context.request.get(server.base+'/api/projects/launch/assets')).json(),longName='Xmas2026_draft_horizontal_master_version_03_with_client_comments_and_final_amendments.mp4';
 await page.route('**/api/projects/launch/assets',route=>route.fulfill({json:existing.map(a=>({...a,name:longName}))}));
 const feedback=[];
 for(const [i,kind]of['pin','drawing','pin'].entries()){
  const response=await context.request.post(server.base+'/api/assets/demo/comments',{data:{body:['First pin','Original second drawing','Third pin'][i],author:'Anna',time:3+i*.04,hotspot:kind==='pin'?{x:.2+i*.2,y:.3}:null,annotations:kind==='drawing'?[{color:'#ec4047',points:[{x:.1,y:.1},{x:.4,y:.4}]}]:[]}});feedback.push(await response.json());
 }
 await context.request.patch(server.base+'/api/assets/demo/comments/'+feedback[1].id,{data:{body:'Edited second drawing'}});
 await page.goto(server.base);await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
 const separator=page.getByRole('separator',{name:'Resize project sidebar'}),sidebar=page.locator('.project-sidebar');
 const width=()=>sidebar.evaluate(el=>el.getBoundingClientRect().width);
 async function atWidth(value){await page.waitForFunction(value=>Math.abs(document.querySelector('.project-sidebar').getBoundingClientRect().width-value)<1,value);}
 assert.equal(await width(),280);
 const label=page.locator('.sidebar-assets button span').first();assert.equal(await label.evaluate(el=>el.scrollWidth<=el.clientWidth),true);assert.ok(await label.evaluate(el=>el.getBoundingClientRect().height>parseFloat(getComputedStyle(el).lineHeight)*2),'Long filenames wrap fully');assert.equal(await page.locator('.sidebar-assets button').first().getAttribute('title'),longName);
 await page.getByLabel('Comment',{exact:true}).fill('Keep this unfinished comment');await page.locator('video').evaluate(el=>el.currentTime=4);await page.waitForFunction(()=>Math.abs(document.querySelector('video').currentTime-4)<.05);
 let handle=await separator.boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+100);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+120,handle.y+100,{steps:12});await page.mouse.up();await atWidth(400);assert.equal(await page.getByLabel('Comment',{exact:true}).inputValue(),'Keep this unfinished comment');assert.ok(Math.abs(await page.locator('video').evaluate(el=>el.currentTime)-4)<.05);
 await separator.press('ArrowLeft');await atWidth(380);await page.reload();await page.getByRole('button',{name:'Play video',exact:true}).waitFor();await atWidth(380);
 await page.setViewportSize({width:1001,height:900});await atWidth(241);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:900});await atWidth(380);
 await separator.press('End');await atWidth(520);await separator.press('Home');await atWidth(210);await separator.dblclick();await atWidth(280);
 handle=await separator.boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+100);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+80,handle.y+100,{steps:8});await atWidth(360);await page.keyboard.press('Escape');await page.mouse.up();await atWidth(280);assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('resizing-sidebar')),false);
 await page.getByRole('button',{name:'Dark mode',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&document.querySelector('.brand-logo')?.complete);
 const pixels=await page.locator('.brand-logo').evaluate(async img=>{await img.decode();const canvas=document.createElement('canvas');canvas.width=885;canvas.height=340;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,885,340);const data=ctx.getImageData(0,0,885,340).data;let white=0,colored=0;for(let i=0;i<data.length;i+=4)if(data[i+3]>0){if(data[i]>=254&&data[i+1]>=254&&data[i+2]>=254)white++;else colored++;}return{white,colored,cutout:ctx.getImageData(768,116,1,1).data[3]};});assert.ok(pixels.white>1000);assert.equal(pixels.colored,0);assert.equal(pixels.cutout,0,'White logo retains a transparent icon cutout');
 const marker=page.locator('.timeline-markers button[data-feedback-count="3"]');await marker.waitFor();assert.equal(await marker.locator('span').innerText(),'3');
 for(const i of[0,1,2,0]){await marker.click();assert.equal(await marker.locator('span').innerText(),String(i+1));await page.locator('#comment-'+feedback[i].id+'.selected').waitFor();await page.waitForFunction(time=>Math.abs(document.querySelector('video').currentTime-time)<.02,feedback[i].time);await page.locator(i===1?'.saved-drawing p':'.saved-pin p').filter({hasText:['First pin','Edited second drawing','Third pin'][i]}).waitFor();assert.match(await marker.getAttribute('title'),new RegExp(`Feedback ${i+1} of 3`));}
 mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/resizable-sidebar.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await separator.isVisible(),false);await page.getByLabel('Choose project',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:900});await atWidth(280);
 const blocked=await browser.newContext();await blocked.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('Storage unavailable');};Storage.prototype.setItem=()=>{throw new Error('Storage unavailable');};});const blockedPage=await blocked.newPage();blockedPage.on('pageerror',e=>errors.push(e.message));await blockedPage.goto(server.base);await blockedPage.getByLabel('Workspace password',{exact:true}).fill('review');await blockedPage.getByRole('button',{name:'Sign in',exact:true}).click();const blockedSeparator=blockedPage.getByRole('separator',{name:'Resize project sidebar'});await blockedSeparator.press('ArrowRight');assert.equal(await blockedSeparator.getAttribute('aria-valuenow'),'300');await blocked.close();
 assert.deepEqual(errors,[]);console.log('PASS: wider wrapping sidebar, pointer/keyboard resizing, saved width, viewport bounds, escape/reset, blocked storage and unchanged drafts/frame');console.log('PASS: pure-white transparent dark logo; grouped pin/drawing feedback cycles 1 → 2 → 3 → 1 including edited text at original timestamps');
}finally{await browser.close();await server.stop();rmSync(dir,{recursive:true,force:true});}
