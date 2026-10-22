import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer,root} from './helpers.mjs';

const dir=mkdtempSync(path.join(tmpdir(),'pvr-theme-')),server=await startServer(dir);
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
const errors=[];
const mode=(page,value)=>page.waitForFunction(value=>document.documentElement.dataset.theme===value,value);
const toggle=page=>page.getByRole('button',{name:'Dark mode',exact:true});
const darkSurface=async locator=>assert.equal(await locator.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(23, 35, 56)');
try{
  const context=await browser.newContext({viewport:{width:1366,height:768},colorScheme:'light'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.base);await page.getByRole('heading',{name:'Set up your workspace'}).waitFor();await mode(page,'light');
  await toggle(page).click();await mode(page,'dark');assert.equal(await toggle(page).getAttribute('aria-pressed'),'true');await darkSurface(page.locator('.auth-card'));
  await page.getByLabel('Your name',{exact:true}).fill('Anna');await page.getByLabel('Workspace password',{exact:true}).fill('review');await page.getByRole('button',{name:'Create workspace'}).click();await page.getByRole('button',{name:'Play video',exact:true}).waitFor();await mode(page,'dark');
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await page.getByLabel('Your name',{exact:true}).fill('Anna');await page.getByLabel('Comment',{exact:true}).fill('Keep this unsent feedback');
  await page.getByLabel('Video timeline').press('End');const time=await page.locator('video').evaluate(el=>el.currentTime);
  await toggle(page).click();await mode(page,'light');await toggle(page).click();await mode(page,'dark');assert.equal(await page.getByLabel('Comment',{exact:true}).inputValue(),'Keep this unsent feedback');assert.ok(Math.abs(await page.locator('video').evaluate(el=>el.currentTime)-time)<.05);
  await darkSurface(page.locator('.comments-panel'));assert.equal(await page.locator('video').evaluate(el=>getComputedStyle(el).filter),'none');
  await page.getByLabel('Comment',{exact:true}).fill('');
  await page.locator('.comment-body').first().click();await darkSurface(page.locator('.saved-pin'));
  await page.locator('.saved-pin').getByRole('button',{name:'Edit comment',exact:true}).click();await darkSurface(page.locator('.feedback-editor'));
  await page.locator('.feedback-editor').getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Project options',exact:true}).filter({visible:true}).click();await darkSurface(page.getByRole('menu'));await page.getByRole('menuitem',{name:'New project',exact:true}).click();await darkSurface(page.getByRole('dialog'));await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Share link',exact:true}).click();const link=await page.getByLabel('Review link',{exact:true}).inputValue();await darkSurface(page.getByRole('dialog'));await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Reviews',exact:true}).click();await page.getByRole('region',{name:'All project reviews'}).waitFor();await darkSurface(page.locator('.review-queue'));await page.getByRole('button',{name:/Review Welcome/}).click();await page.getByRole('button',{name:'Play video',exact:true}).waitFor();
  mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/dark-desktop.png'),fullPage:true});
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await toggle(page).click();await mode(page,'light');await toggle(page).click();await mode(page,'dark');}
  await page.screenshot({path:path.join(root,'test-results/dark-mobile.png'),fullPage:true});
  await page.reload();await page.getByRole('button',{name:'Play video',exact:true}).waitFor();await mode(page,'dark');
  await page.goto(server.base+'/admin');await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();await mode(page,'dark');await darkSurface(page.locator('.admin-card').first());await page.screenshot({path:path.join(root,'test-results/dark-admin.png'),fullPage:true});
  const other=await context.newPage();await other.goto(server.base);await mode(other,'dark');await toggle(other).click();await mode(other,'light');await mode(page,'light');await other.close();
  const guest=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light'}),client=await guest.newPage();client.on('pageerror',e=>errors.push(e.message));await client.goto(link);await client.getByRole('button',{name:'Sign in',exact:true}).waitFor();await mode(client,'light');await toggle(client).click();await mode(client,'dark');await client.getByLabel('Workspace password',{exact:true}).fill('review');await client.getByRole('button',{name:'Sign in',exact:true}).click();await client.getByRole('button',{name:'Play video',exact:true}).waitFor();await mode(client,'dark');await darkSurface(client.locator('.comments-panel'));assert.ok(await client.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await guest.close();
  console.log('PASS: light/dark header toggle, remembered preference, cross-tab sync, unchanged video/drafts, dark projects/reviews/dialogs/admin and mobile shared reviews');
  const system=await browser.newContext({colorScheme:'dark',viewport:{width:320,height:740}}),systemPage=await system.newPage();systemPage.on('pageerror',e=>errors.push(e.message));await systemPage.goto(server.base);await systemPage.getByRole('button',{name:'Sign in',exact:true}).waitFor();await mode(systemPage,'dark');await darkSurface(systemPage.locator('.auth-card'));assert.ok(await systemPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await systemPage.emulateMedia({colorScheme:'light'});await mode(systemPage,'light');await toggle(systemPage).click();await mode(systemPage,'dark');await systemPage.emulateMedia({colorScheme:'dark'});await systemPage.emulateMedia({colorScheme:'light'});await mode(systemPage,'dark');await system.close();
  const blocked=await browser.newContext({colorScheme:'light'});await blocked.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new Error('Storage unavailable');};Storage.prototype.setItem=()=>{throw new Error('Storage unavailable');};});const blockedPage=await blocked.newPage();blockedPage.on('pageerror',e=>errors.push(e.message));await blockedPage.goto(server.base);await blockedPage.getByRole('button',{name:'Sign in',exact:true}).waitFor();await toggle(blockedPage).click();await mode(blockedPage,'dark');await toggle(blockedPage).click();await mode(blockedPage,'light');await blocked.close();
  const boot=await browser.newContext({colorScheme:'dark'}),bootPage=await boot.newPage();await bootPage.route(/\/assets\/.*\.js$/,route=>route.abort());await bootPage.goto(server.base);await mode(bootPage,'dark');assert.equal(await bootPage.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(16, 26, 42)');await boot.close();
  assert.deepEqual(errors,[]);console.log('PASS: follows system appearance until explicitly chosen, works with blocked storage, and applies dark appearance before React loads');
}finally{await browser.close();await server.stop();rmSync(dir,{recursive:true,force:true});}
