// PoC: drive the REAL demo UI in Chromium, speak via a fake-mic WAV, listen via a
// WebAudio tap, press buttons, measure reaction time, and catch UI+pipeline bugs.
//
//   node ui_test.mjs <baseUrl>
//
// Chromium is launched (by run.sh) with --use-file-for-fake-audio-capture so
// getUserMedia() returns a real voice WAV — the actual UI captures + streams it
// through the real pipeline. We collect: console errors, failed/《4xx-5xx》 requests,
// WebSocket close codes, the app's own end-to-end latency readout, an independent
// bot-audio onset + glitch timeline (RMS via an AnalyserNode we splice before the
// audio destination), the transcript, and screenshots.
const { chromium } = require('playwright');
const { writeFileSync } = require('node:fs');

const BASE = process.argv[2] || 'http://localhost:7862';
const OUT = '/work/out';
const report = { base: BASE, startedAt: new Date().toISOString(), steps: [], bugs: [],
                 consoleErrors: [], failedRequests: [], badResponses: [], wsClosures: [] };
const log = (m) => { console.log(`[uitest] ${m}`); report.steps.push(`${Date.now()} ${m}`); };
const bug = (sev, m, extra) => { report.bugs.push({ sev, m, ...(extra||{}) }); console.log(`[BUG:${sev}] ${m}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Injected BEFORE any page script: splice an AnalyserNode before the audio
// destination so we can time when the bot actually starts speaking and sample its
// level (to spot dropouts / silence). Records an RMS timeline in window.__bot.
const TAP = `
window.__bot = { t0: performance.now(), onsetMs: null, rms: [] };
(function(){
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(dest, ...rest){
    try {
      if (dest instanceof AudioDestinationNode) {
        const ctx = dest.context;
        if (!ctx.__tap) {
          const an = ctx.createAnalyser(); an.fftSize = 1024; an.__buf = new Float32Array(an.fftSize);
          origConnect.call(an, ctx.destination);
          ctx.__tap = an;
          setInterval(() => {
            an.getFloatTimeDomainData(an.__buf);
            let s=0; for (let i=0;i<an.__buf.length;i++){ const v=an.__buf[i]; s+=v*v; }
            const rms = Math.sqrt(s/an.__buf.length);
            const now = performance.now();
            if (rms > 0.008 && window.__bot.onsetMs === null) window.__bot.onsetMs = now;
            window.__bot.rms.push([Math.round(now - window.__bot.t0), +rms.toFixed(4)]);
          }, 25);
        }
        return origConnect.call(this, ctx.__tap, ...rest);
      }
    } catch(e){}
    return origConnect.call(this, dest, ...rest);
  };
})();
`;

// From the RMS timeline: segment into bot-speaking bursts. A REAL dropout is a
// short silence (250–1200ms) WITHIN a spoken response; larger gaps are turn/
// greeting boundaries (the bot greets, then answers) and must NOT count.
function analyzeAudio(rms) {
  if (!rms || rms.length < 5) return { spoke: false };
  const SP = 0.012, DROP_MIN = 300, DROP_MAX = 1200;
  const active = rms.filter(([, r]) => r > SP);
  if (!active.length) return { spoke: false, maxRms: +Math.max(...rms.map(x => x[1])).toFixed(3) };
  // group active samples into segments (a gap > DROP_MAX starts a new segment)
  const segs = []; let cur = null; let dropouts = 0, maxDropMs = 0, prev = null;
  for (const [t] of active) {
    if (prev !== null) {
      const g = t - prev;
      if (g > DROP_MAX) { segs.push(cur); cur = null; }
      else if (g >= DROP_MIN) { dropouts++; maxDropMs = Math.max(maxDropMs, g); }
    }
    if (!cur) cur = { startMs: t, endMs: t };
    cur.endMs = t; prev = t;
  }
  if (cur) segs.push(cur);
  return { spoke: true, segments: segs.length,
           firstOnsetMs: segs[0].startMs, lastEndMs: segs[segs.length - 1].endMs,
           totalSpeakMs: segs.reduce((s, x) => s + (x.endMs - x.startMs), 0),
           dropouts, maxDropMs, maxRms: +Math.max(...active.map(x => x[1])).toFixed(3) };
}

async function shot(page, name) { try { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); } catch(e){} }

(async () => {
  const MIC = process.env.MIC_WAV || '/audio/mic_planet_48k.wav';
  const browser = await chromium.launch({ headless: true, args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${MIC}`,
    '--autoplay-policy=no-user-gesture-required',
  ]});
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(TAP);
  const page = await ctx.newPage();

  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0,300)); });
  page.on('pageerror', (e) => report.consoleErrors.push('pageerror: ' + String(e).slice(0,300)));
  page.on('requestfailed', (r) => report.failedRequests.push(`${r.method()} ${r.url().slice(0,120)} :: ${r.failure()?.errorText}`));
  page.on('response', (r) => { const s = r.status(); if (s >= 400) report.badResponses.push(`${s} ${r.url().slice(0,120)}`); });
  page.on('websocket', (ws) => { ws.on('close', () => report.wsClosures.push(`closed ${ws.url().slice(0,80)}`)); });

  try {
    log(`goto ${BASE}`);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500); await shot(page, '01-landing');

    // --- pick Generic Assistant + Nano (faster), then Start ---
    const nano = page.getByText('Try with Nemotron Nano', { exact: false });
    if (await nano.count()) { await nano.first().click(); log('selected Nano model'); }
    else { await page.locator('.example-card').first().click(); log('selected first example card'); }
    await sleep(400);
    const start = page.getByRole('button', { name: /start conversation/i });
    await start.click({ timeout: 10000 });
    const tStart = Date.now();
    log('clicked Start conversation');

    // --- wait for connect, then a completed turn (latency readout populated) ---
    let connected = false, latencyText = '', caption = '', transcript = '';
    for (let i = 0; i < 75; i++) {           // up to ~60s
      await sleep(1000);
      caption = (await page.locator('.conv-orb-caption').first().innerText().catch(()=>'')) || caption;
      if (!connected && /connected|listening|speaking|thinking/i.test(caption)) { connected = true; report.connectMs = Date.now()-tStart; log(`connected (caption="${caption.trim()}", ${report.connectMs}ms)`); await shot(page,'02-connected'); }
      const lv = await page.locator('.conv-latency__value').first().innerText().catch(()=> '');
      if (lv && lv.trim() !== '—' && /\d/.test(lv)) { latencyText = lv.trim(); }
      transcript = await page.locator('.conv-message-list, .transcript-message').allInnerTexts().then(a=>a.join(' | ')).catch(()=> '') || transcript;
      if (latencyText && /bot|speaking/i.test(caption) || (latencyText && transcript)) { log(`turn observed: latency=${latencyText}`); break; }
    }
    await sleep(1500); await shot(page, '03-turn');

    const audio = await page.evaluate(() => window.__bot);
    const a = analyzeAudio(audio?.rms);
    report.turn = {
      connected, appLatencyReadout: latencyText || null,
      botAudioOnsetMs: audio?.onsetMs ? Math.round(audio.onsetMs - audio.t0) : null,
      audio: a, caption: caption.trim(), transcriptChars: transcript.length,
      transcriptSample: transcript.slice(0, 200),
    };
    if (!connected) bug('high', 'never reached connected state');
    if (!a.spoke) bug('high', 'no bot audio detected (pipeline produced no speech)', { maxRms: a.maxRms });
    if (a.spoke && a.dropouts) bug('med', `bot audio has ${a.dropouts} mid-speech dropout(s) (max ${a.maxDropMs}ms)`);
    if (!latencyText) bug('med', 'app never displayed an end-to-end latency (turn may not have completed)');

    // --- End the session, check the thanks modal ---
    const endBtn = page.locator('.clean-end, button:has-text("End")').first();
    if (await endBtn.count()) { await endBtn.click().catch(()=>{}); log('clicked End'); }
    await sleep(1500);
    const thanks = await page.getByText(/thank you/i).count();
    report.endedShowsThanks = thanks > 0;
    if (!thanks) bug('low', 'End did not show the thank-you modal');
    await shot(page, '04-ended');
    // close modal (cross) -> back home
    await page.locator('.demo-modal-close, button:has-text("Start a new session")').first().click().catch(()=>{});
    await sleep(800);

    // --- Settings: open, read TTS options, toggle, close ---
    const gear = page.locator('.icon-btn--settings, [aria-label="Settings"]').first();
    if (await gear.count()) {
      await gear.click().catch(()=>{}); await sleep(600); await shot(page, '05-settings');
      const tts = await page.locator('.set-tts-btn').allInnerTexts().catch(()=>[]);
      report.ttsOptions = tts;
      if (tts.length >= 2) { await page.locator('.set-tts-btn').nth(1).click().catch(()=>{}); log(`toggled TTS -> ${tts[1]}`); }
      else bug('low', 'TTS engine switch not found in Settings');
      await page.locator('.page-panel__foot button, button:has-text("Done"), .icon-btn').first().click().catch(()=>{});
    } else bug('low', 'Settings gear not found');

  } catch (e) {
    bug('high', 'scenario threw: ' + String(e).slice(0, 300));
    await shot(page, 'zz-error');
  } finally {
    report.finishedAt = new Date().toISOString();
    writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    console.log('\n===== UITEST REPORT =====');
    console.log(JSON.stringify({ connectMs: report.connectMs, turn: report.turn, ttsOptions: report.ttsOptions,
      endedShowsThanks: report.endedShowsThanks, bugs: report.bugs,
      consoleErrors: report.consoleErrors.slice(0,8), badResponses: report.badResponses.slice(0,8),
      failedRequests: report.failedRequests.slice(0,8), wsClosures: report.wsClosures }, null, 2));
    await browser.close();
  }
})();
