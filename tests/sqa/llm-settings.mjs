// SPDX-License-Identifier: BSD-2-Clause
// Model controls: persisted setup, live snapshots, isolation, and real spoken turns.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as H from './lib/harness.mjs';
import {detectAudibleWav} from './lib/acoustics.mjs';
const report={checks:[],sessions:[],hardFails:[]};
const signals=H.newSignals();
const slot=await H.createAudioSlot(93);
const browser=await H.launchBrowser({env:slot.env});
const {page}=await H.newPage(browser,signals,{viewport:{width:1440,height:1000}});
const configs=[];
page.on('request',request=>{if(new URL(request.url()).pathname==='/api/session-config'&&request.method()==='POST') configs.push(request.postDataJSON());});
const dialog=page.getByRole('dialog',{name:'LLM settings',exact:true});
const input=(role,name)=>dialog.getByLabel(`${role} ${name}`,{exact:true});
async function setup(example) {
  await page.locator('.example-card').filter({hasText:example}).click();
  assert(await H.waitForDeploymentReady(page));
  await page.getByRole('button',{name:'Tools',exact:true}).click();
  await page.getByRole('button',{name:'LLM settings',exact:true}).click();
  await dialog.locator('.llm-role').first().waitFor();
}
async function close() {await dialog.getByRole('button',{name:'Close LLM settings',exact:true}).click();}
async function save() {await dialog.getByRole('button',{name:'Save settings',exact:true}).click();await dialog.getByRole('status').filter({hasText:'Saved for your next conversation.'}).waitFor();}
async function fit() {
  const bounds=await dialog.boundingBox();const width=page.viewportSize().width;
  assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
}
async function liveSettings() {
  await page.getByRole('button',{name:'LLM settings',exact:true}).click();
  await dialog.locator('.llm-role').first().waitFor();
}
async function apply() {
  const responseWait=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/llm-settings')&&response.request().method()==='PUT');
  await dialog.getByRole('button',{name:'Apply to session',exact:true}).click();
  const response=await responseWait;assert.equal(response.status(),200);
  await dialog.getByRole('status').filter({hasText:'Applied. Future requests'}).waitFor();
  return response.json();
}
async function end(sid) {
  await page.getByRole('button',{name:'End',exact:true}).click();
  await page.getByRole('dialog',{name:'Session ended',exact:true}).waitFor();
  assert(await H.dismissFeedback(page));
  let status=200;
  for(let attempt=0;attempt<20;attempt++) {
    status=(await page.request.get(`${H.BASE}/api/sessions/${sid}/llm-settings`)).status();
    if(status===404) break;
    await H.sleep(250);
  }
  assert.equal(status,404,'Ended settings must be removed');
  await H.waitForDeploymentReady(page);
}
try {
  await page.goto(H.BASE);assert(await H.waitForDeploymentReady(page));
  assert.equal(await page.getByRole('button',{name:'LLM settings',exact:true}).count(),0,'No extra landing action');
  await setup('Generic Frontend/Backend');
  assert.equal(await dialog.locator('.llm-role').count(),2);
  assert.equal(await input('Frontend · Talker','Temperature').inputValue(),'0');
  assert.equal(await input('Backend · Thinker','Max tokens').inputValue(),'2048');
  for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,700]]) {
    await page.setViewportSize({width,height});await fit();
    await H.shot(page,`${H.OUT}/generic-${width}.png`);
    report.checks.push({name:`modal-fit-${width}`,pass:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await input('Frontend · Talker','Temperature').fill('2.1');
  assert.equal(await input('Frontend · Talker','Temperature').getAttribute('aria-invalid'),'true');
  assert(await dialog.getByRole('button',{name:'Save settings',exact:true}).isDisabled());
  await input('Frontend · Talker','Temperature').fill('0.1');
  await input('Backend · Thinker','Top P').fill('0.85');
  await input('Backend · Thinker','Max tokens').fill('1800');
  await save();await close();
  await page.reload();await page.getByRole('button',{name:'Back to setup',exact:true}).waitFor();
  await page.getByRole('button',{name:'LLM settings',exact:true}).click();await dialog.locator('.llm-role').first().waitFor();
  assert.equal(await input('Frontend · Talker','Temperature').inputValue(),'0.1');
  assert.equal(await input('Backend · Thinker','Max tokens').inputValue(),'1800');
  await input('Frontend · Talker','Temperature').fill('0.6');await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  await page.getByRole('button',{name:'LLM settings',exact:true}).click();await dialog.locator('.llm-role').first().waitFor();
  assert.equal(await input('Frontend · Talker','Temperature').inputValue(),'0.1','Unapplied draft is discarded');
  await close();await page.getByRole('button',{name:'Back to setup',exact:true}).click();
  report.checks.push({name:'validation-persistence-and-cancel',pass:true});
  await setup('Nemotron Omni');assert.equal(await dialog.locator('.llm-role').count(),4);
  for(const role of ['Speaker','Thinker','Media Analyzer','Webcam']) {
    const section=dialog.locator('.llm-role').filter({has:page.getByRole('heading',{name:role,exact:true})});
    await section.locator('summary').click();
    assert.equal(await input(role,'Top K').inputValue(),'1');
    await input(role,'Top K').fill('-1');
    await input(role,'Top P').fill('0.9');
  }
  await input('Speaker','Temperature').fill('0.2');
  await page.setViewportSize({width:390,height:844});await fit();await H.shot(page,`${H.OUT}/omni-phone.png`);
  await page.setViewportSize({width:1440,height:1000});await save();await close();await page.getByRole('button',{name:'Back to setup',exact:true}).click();
  report.checks.push({name:'omni-four-roles-and-greedy-override',pass:true});
  for(const [example,mode] of [['Generic Frontend/Backend','generic-frontend-backend-agent'],['Nemotron Omni','omni-assistant-subagents']]) {
    await page.locator('.example-card').filter({hasText:example}).click();await H.waitForDeploymentReady(page);
    assert((await H.startConversation(page,{timeoutMs:60000})).connected);
    await page.locator('.conv-live').waitFor({timeout:60000});await H.waitListening(page,{timeoutMs:60000});
    const sid=await H.sessionId(page);assert(sid);
    assert.equal(configs.at(-1).pipeline_mode,mode);
    assert.equal(configs.at(-1).llm_settings[mode=== 'generic-frontend-backend-agent' ? 'frontend' : 'speaker'].temperature,mode=== 'generic-frontend-backend-agent' ? 0.1 : 0.2);
    await liveSettings();
    const role=mode==='generic-frontend-backend-agent'?'Frontend · Talker':'Speaker';
    await input(role,'Temperature').fill('0.15');
    if(mode==='generic-frontend-backend-agent') await input('Backend · Thinker','Temperature').fill('0.1');
    const applied=await apply();assert.equal(applied.revision,1);
    const fetched=await (await page.request.get(`${H.BASE}/api/sessions/${sid}/llm-settings`)).json();
    assert.equal(fetched.settings[mode==='generic-frontend-backend-agent'?'frontend':'speaker'].temperature,0.15);
    await H.shot(page,`${H.OUT}/live-${mode}.png`);await close();
    await H.installToolWatch(page);const toolMark=await H.toolWatchMark(page);
    const turn=await H.turn(page,mode==='generic-frontend-backend-agent'?'What is the current time in Tokyo?':'Please say hello in one sentence.',`llm-${mode}`,{
      micDevice:slot.micSink,spkDevice:slot.spkSink,monitor:slot.spkMonitor,settle:true,
    });
    const acoustics=await detectAudibleWav(turn.wav);
    const tools=await H.toolWatchSince(page,toolMark);
    if(mode==='generic-frontend-backend-agent') assert(tools.includes('get_current_time'),'Generic must exercise the updated backend planner');
    assert(turn.inputReceived&&turn.domUser,'Actual user speech must reach the model');
    assert(turn.domBot&&acoustics.audible,'Actual model response must be spoken');
    assert(!turn.botAsrError,turn.botAsrError);
    await liveSettings();
    await dialog.getByRole('button',{name:'Reset all',exact:true}).click();await apply();
    assert.equal(await input(role,'Temperature').inputValue(),mode==='generic-frontend-backend-agent'?'0':'0.7');
    await close();await end(sid);
    report.sessions.push({mode,sid,settingsAcknowledged:true,resetAcknowledged:true,settingsRemovedAfterEnd:true,tools,turn,acoustics});
  }
  assert.equal(signals.consoleErrors.length,0,JSON.stringify(signals.consoleErrors));
  assert.equal(signals.failedRequests.length,0,JSON.stringify(signals.failedRequests));
  report.checks.push({name:'two-real-spoken-sessions-live-apply-reset-and-cleanup',pass:true});
} catch(error) {
  report.hardFails.push(String(error?.stack||error));
  await H.shot(page,`${H.OUT}/failure.png`).catch(()=>{});
} finally {
  report.signals=signals;fs.writeFileSync(`${H.OUT}/llm-settings-report.json`,JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify({checks:report.checks,sessions:report.sessions.map(({mode,sid})=>({mode,sid})),hardFails:report.hardFails}));
if(report.hardFails.length) process.exit(1);
