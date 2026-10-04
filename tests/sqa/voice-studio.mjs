// SPDX-License-Identifier: BSD-2-Clause
// Browser acceptance for setup studios and the per-session consent gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {chromium}=await import(process.env.SQA_PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.SQA_BASE || 'http://localhost:7880';
const out=process.env.SQA_OUT || '/tmp/nva-voice-studio';
fs.mkdirSync(out,{recursive:true});
const live=process.env.SQA_LIVE==='true';
const report={base,live,checks:[],sessions:[],errors:[]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',...(process.env.SQA_MIC_WAV ? [`--use-file-for-fake-audio-capture=${process.env.SQA_MIC_WAV}`] : [])]});
let current;
async function ready(page) {await page.waitForFunction(()=>document.querySelectorAll('.example-card').length===2&&!document.querySelector('[data-tour="start"]')?.disabled);}
async function fit(page,name) {assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} fits viewport`);}
async function context() {
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},permissions:['microphone'],reducedMotion:'reduce'});
  await ctx.addInitScript(()=>{
    window.__studioMicRequests=0;window.__studioRms=0;window.__studioSockets=[];
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket {constructor(...args){super(...args);window.__studioSockets.push(this);}};
    const media=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=(...args)=>{window.__studioMicRequests++;return media(...args);};
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination,...rest){
      if(destination instanceof AudioDestinationNode&&!this.context.__studioTap){
        const analyser=this.context.createAnalyser();this.context.__studioTap=analyser;analyser.fftSize=1024;connect.call(analyser,destination);
        const samples=new Float32Array(analyser.fftSize);
        setInterval(()=>{analyser.getFloatTimeDomainData(samples);window.__studioRms=Math.max(window.__studioRms,Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length));},40);
        return connect.call(this,analyser,...rest);
      }return connect.call(this,destination,...rest);
    };
  });
  const page=await ctx.newPage();current=page;
  page.on('pageerror',error=>report.errors.push(String(error)));
  if(process.env.SQA_PREVIEW_DEFAULTS) await page.route('**/api/tts/pronunciations',route=>route.fulfill({json:JSON.parse(fs.readFileSync(process.env.SQA_PREVIEW_DEFAULTS,'utf8'))}));
  return {ctx,page};
}
try {
  const {ctx,page}=await context();const sessionConfigs=[];
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/session-config'&&request.method()==='POST')sessionConfigs.push(request.postDataJSON());});
  await page.goto(base);await ready(page);
  assert.deepEqual(await page.locator('.startview__actions button').allTextContents(),['Prompts','Tools','Voice','Start conversation']);
  assert.equal(await page.locator('[data-tour="settings"], [data-tour="pipeline"]').count(),0);
  assert.equal(await page.evaluate(()=>window.__studioMicRequests),0,'No microphone acquisition before choice');
  await page.getByRole('button',{name:'Tools',exact:true}).click();
  await page.locator('.agent-roles').waitFor();
  const tools=page.locator('.tool-selector input');assert(await tools.count()>=4);
  const before=await tools.first().isChecked();await tools.first().setChecked(!before);
  await page.getByRole('button',{name:'Back to setup',exact:true}).click();
  await page.getByRole('button',{name:'Tools',exact:true}).click();assert.equal(await tools.first().isChecked(),!before);await tools.first().setChecked(before);
  await page.getByRole('button',{name:'Back to setup',exact:true}).click();
  await page.getByRole('button',{name:'Voice',exact:true}).click();
  const engines=page.locator('input[name="tts-engine"]');assert(await engines.count()>=2);
  const voices=page.locator('input[name="tts-voice"]');await voices.first().waitFor();assert(await voices.count()>=2);
  await voices.first().check();await voices.first().press('ArrowRight');assert(await voices.nth(1).isChecked());
  await page.getByLabel('Word',{exact:true}).fill('two words');await page.getByLabel('IPA pronunciation',{exact:true}).fill('tu');
  await page.getByRole('button',{name:'Save pronunciation',exact:true}).click();await page.getByRole('alert').filter({hasText:'Enter one word'}).waitFor();
  await page.getByLabel('Word',{exact:true}).fill('Spookotron');await page.getByLabel('IPA pronunciation',{exact:true}).fill('/ˈspukətɹɑn/');
  await page.getByRole('button',{name:'Save pronunciation',exact:true}).click();
  await page.getByRole('listitem').filter({hasText:'Spookotron'}).waitFor();
  await page.reload();await page.getByRole('listitem').filter({hasText:'Spookotron'}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/voice');
  report.checks.push({name:'tools-voices-ipa-persistence',pass:true});
  await page.waitForFunction(()=>!document.querySelector('.speech-engines')?.disabled && !document.querySelector('.voice-studio__play')?.disabled);
  for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,700]]) {
    await page.waitForFunction(()=>!document.querySelector('.voice-studio__play')?.disabled);
    await page.setViewportSize({width,height});await fit(page,`voice-${width}`);
    await page.screenshot({path:`${out}/voice-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Back to setup',exact:true}).click();await ready(page);await fit(page,`landing-${width}`);
    await page.getByRole('button',{name:'Tools',exact:true}).click();await fit(page,`tools-${width}`);
    await page.getByRole('button',{name:'Back to setup',exact:true}).click();
    await page.getByRole('button',{name:'Start conversation',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Help improve the conversation?',exact:true});await dialog.waitFor();
    assert(await dialog.getByRole('button',{name:'Continue without saving',exact:true}).isVisible());
    assert(await dialog.getByRole('button',{name:'Allow and start',exact:true}).isVisible());
    assert(!(await dialog.getByRole('checkbox',{name:/Keep a downloadable recording/}).isChecked()));
    const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);await fit(page,`consent-${width}`);
    await page.screenshot({path:`${out}/consent-${width}.png`});
    await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
    assert(await page.locator('[data-tour="start"]').evaluate(el=>el===document.activeElement));
    assert.equal(sessionConfigs.length,0);assert.equal(await page.evaluate(()=>window.__studioMicRequests),0);
    await page.getByRole('button',{name:'Voice',exact:true}).click();report.checks.push({name:`responsive-cancel-${width}`,pass:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  // An unsupported engine retains saved rules and keeps IPA editing disabled.
  const chatterbox=page.locator('.speech-engine').filter({hasText:/chatterbox/i});await chatterbox.locator('input').check();
  assert(await page.getByLabel('Word',{exact:true}).isDisabled());
  assert(await page.getByRole('listitem').filter({hasText:'Spookotron'}).count()>0);
  const magpie=page.locator('.speech-engine').filter({hasText:/magpie(?!.*zero)/i}).first();await magpie.locator('input').check();
  await page.getByLabel('Word',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.pronunciation-form input')?.disabled);
  report.checks.push({name:'engine-capability-preserves-ipa',pass:true});
  if(live) {
    const previewWait=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tts/preview'&&response.request().method()==='POST');
    await page.getByRole('button',{name:'Preview voice',exact:true}).click();const preview=await previewWait;
    assert.equal(preview.status(),200);assert.equal(preview.request().postDataJSON().tts_pronunciations.Spookotron,'ˈspukətɹɑn');
    const player=page.locator('.voice-studio audio');await player.waitFor();
    const audio=await player.evaluate(async el=>{const bytes=new Uint8Array(await(await fetch(el.src)).arrayBuffer());return {size:bytes.length,magic:String.fromCharCode(...bytes.slice(0,4))};});
    assert(audio.size>1000&&audio.magic==='RIFF');await player.evaluate(el=>el.pause());
    report.checks.push({name:'real-ipa-preview',pass:true,bytes:audio.size});
  }
  if(process.env.SQA_VOICE_SAMPLE) {
    await page.locator('.voice-studio input[type=file]').setInputFiles(process.env.SQA_VOICE_SAMPLE);
    await page.locator('.voice-studio__filename').waitFor();
    await page.locator('.speech-engine').filter({hasText:/zero.?shot/i}).locator('input').check();
    await page.waitForFunction(()=>!document.querySelector('.voice-studio__play')?.disabled);
    await page.getByRole('checkbox',{name:'Use sample for zero-shot voice',exact:true}).check();
    await page.reload();await page.getByRole('checkbox',{name:'Use sample for zero-shot voice',exact:true}).waitFor();
    assert(!(await page.getByRole('checkbox',{name:'Use sample for zero-shot voice',exact:true}).isChecked()),'A reloaded sample requires re-enabling');
    await page.getByRole('checkbox',{name:'Use sample for zero-shot voice',exact:true}).check();
    await page.waitForFunction(()=>!document.querySelector('.voice-studio__play')?.disabled);
    if(live) {
      const previewWait=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/tts/preview'&&response.request().method()==='POST');
      await page.getByRole('button',{name:'Preview voice',exact:true}).click();const preview=await previewWait;
      assert.equal(preview.status(),200);const payload=preview.request().postDataJSON();assert(payload.tts_voice_sample.length>1000);assert.equal(payload.tts_pronunciations.Spookotron,'ˈspukətɹɑn');
      await page.locator('.voice-studio audio').waitFor();await page.locator('.voice-studio audio').evaluate(el=>el.pause());
    }
    report.checks.push({name:'zero-shot-sample-persistence-and-preview',pass:true,livePreview:live});
    await page.locator('.speech-engine').filter({hasText:/^.*Magpie TTS(?! Zeroshot)/i}).first().locator('input').check();
    await page.waitForFunction(()=>!document.querySelector('.voice-studio__play')?.disabled);
    await page.getByRole('button',{name:'Remove sample',exact:true}).click();await page.locator('.voice-studio__filename').waitFor({state:'detached'});
  }
  await page.getByRole('button',{name:'Back to setup',exact:true}).click();
  await page.locator('.example-card').filter({hasText:/omni/i}).click();await ready(page);
  await page.getByRole('button',{name:'Voice',exact:true}).click();
  await page.getByRole('heading',{name:'Pronunciation fixes',exact:true}).waitFor();
  assert.equal(await page.getByRole('listitem').filter({hasText:'Spookotron'}).count(),0,'IPA edits are assistant-specific');
  await page.getByRole('button',{name:'Back to setup',exact:true}).click();
  report.checks.push({name:'assistant-isolation',pass:true});
  if(live) {
    for(const [example,consent] of [['Generic Frontend/Backend',true],['Nemotron Omni',false]]) {
      await page.locator('.example-card').filter({hasText:example}).click();await ready(page);
      await page.evaluate(()=>{window.__studioRms=0;});
      await page.getByRole('button',{name:'Start conversation',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Help improve the conversation?',exact:true});await dialog.waitFor();
      await dialog.getByRole('button',{name:consent?'Allow and start':'Continue without saving',exact:true}).click();
      await page.locator('.conv-live').waitFor({timeout:60000});
      const hints=page.locator('.conversation-hints');await hints.waitFor({timeout:5000});const started=Date.now();
      assert.equal(await hints.evaluate(el=>getComputedStyle(el).pointerEvents),'none');
      assert((await hints.boundingBox()).width<=266);assert.equal(await page.getByRole('button',{name:'Audio settings',exact:true}).count(),1);
      assert.equal(await page.getByRole('button',{name:'Agent configuration',exact:true}).count(),1);
      await hints.waitFor({state:'detached',timeout:3500});const hintsDurationMs=Date.now()-started;assert(hintsDurationMs<=2600);
      await page.waitForFunction(()=>window.__studioRms>0.002,null,{timeout:60000});
      await page.getByRole('button',{name:'Audio settings',exact:true}).click();
      const settings=page.getByRole('dialog',{name:'Settings',exact:true});assert.equal(await settings.getByRole('combobox').count(),2);
      await settings.getByRole('button',{name:'Close settings',exact:true}).click();
      await page.getByRole('button',{name:'Agent configuration',exact:true}).click();
      const info=page.getByRole('dialog',{name:'Pipeline info',exact:true});await info.getByRole('heading',{name:'Voice configuration',exact:true}).waitFor();
      await info.getByRole('button',{name:'Close',exact:true}).last().click();
      const sessionId=await page.locator('.conv-session-id code').innerText();
      const captureWait=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/session-capture'&&response.request().method()==='POST');
      if(consent) await page.getByRole('button',{name:'End',exact:true}).click();
      else await page.evaluate(()=>window.__studioSockets.forEach(socket=>{if(socket.readyState===WebSocket.OPEN) socket.close(4001,'studio-reconnect-test');}));
      await page.getByRole('dialog',{name:consent?'Session ended':'Session interrupted',exact:true}).waitFor();
      const capture=await captureWait;const body=capture.request().postDataJSON();assert.equal(capture.status(),200);assert.equal(body.consent,consent);
      if(!consent) assert(!body.transcript);
      report.sessions.push({example,sessionId,consent,audibleWelcome:true,captureAcknowledged:true,hintsDurationMs});
      if(!consent) {
        await page.getByRole('button',{name:'Reconnect',exact:true}).click();
        await page.getByRole('dialog',{name:'Help improve the conversation?',exact:true}).waitFor();
        await page.keyboard.press('Escape');assert.equal(sessionConfigs.length,report.sessions.length,'Reconnect is also gated');
      }
      await page.getByRole('button',{name:'Close and return home',exact:true}).click();
      assert.equal(await page.locator('[data-tour="settings"], [data-tour="pipeline"]').count(),0);
    }
    assert.equal(sessionConfigs[0].tts_pronunciations.Spookotron,'ˈspukətɹɑn');
    assert(!sessionConfigs[1].tts_pronunciations?.Spookotron);
  }
  await ctx.close();assert.equal(report.errors.length,0);report.pass=true;
} catch(error){report.pass=false;report.failure=String(error);if(current&&!current.isClosed())await current.screenshot({path:`${out}/failure.png`,fullPage:true});throw error;}
finally{fs.writeFileSync(`${out}/voice-studio-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
