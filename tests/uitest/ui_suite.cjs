// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Multi-scenario UI + pipeline regression suite (real browser, real voice).
//
//   node ui_suite.cjs <baseUrl>
//
// Reads scenarios.json (built by prep_mics.py from tests/voicetest/quality_spec).
// For EACH scenario it launches a fresh Chromium whose microphone is that
// scenario's fake-mic WAV (--use-file-for-fake-audio-capture is a launch arg, so
// one browser per scenario), drives the real demo UI (pick example+model, Start),
// waits for a completed turn, and asserts:
//   * connected                                   (hard)
//   * bot actually produced speech (WebAudio tap)  (hard)
//   * app end-to-end latency <= per-category budget (hard)
//   * NO console errors — incl. the "Unknown frame kind" regression (hard)
//   * no 4xx/5xx responses, no error WS closes      (hard)
//   * 0 mid-speech dropouts                          (warn)
//   * expected-answer regex present in transcript    (warn; omni is s2s, may lack text)
// Then a visual-diff pass compares the (animation-frozen) landing + settings
// screenshots against committed baselines in baseline/ (pixelmatch).
//
// Output: out/suite_report.json + per-scenario screenshots + a console summary.
// Exit code is non-zero if any HARD assertion failed (CI-friendly).
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
let PNG = null, pixelmatch = null;
try { PNG = require('pngjs').PNG; pixelmatch = require('pixelmatch'); } catch (_) { /* visual diff optional */ }

const BASE = process.argv[2] || 'http://localhost:7862';
const HERE = '/work';
const OUT = path.join(HERE, 'out');
const BASELINE = path.join(HERE, 'baseline');
const VIS_THRESHOLD = parseFloat(process.env.VIS_THRESHOLD || '0.006'); // 0.6% pixels
const UPDATE_BASELINE = process.env.UPDATE_BASELINE === '1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(BASELINE, { recursive: true });

// ---- WebAudio tap: time when the bot speaks + sample level for dropouts ----
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
          origConnect.call(an, ctx.destination); ctx.__tap = an;
          setInterval(() => {
            an.getFloatTimeDomainData(an.__buf);
            let s=0; for (let i=0;i<an.__buf.length;i++){ const v=an.__buf[i]; s+=v*v; }
            const rms = Math.sqrt(s/an.__buf.length), now = performance.now();
            if (rms > 0.008 && window.__bot.onsetMs === null) window.__bot.onsetMs = now;
            window.__bot.rms.push([Math.round(now - window.__bot.t0), +rms.toFixed(4)]);
          }, 25);
        }
        return origConnect.call(this, ctx.__tap, ...rest);
      }
    } catch(e){}
    return origConnect.call(this, dest, ...rest);
  };
})();`;

// Freeze animations/gradients so screenshots are deterministic for visual diff.
const FREEZE_CSS = `
*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
.wm-flow { background: #76b900 !important; -webkit-background-clip: initial !important;
           background-clip: initial !important; -webkit-text-fill-color: #76b900 !important; color: #76b900 !important; }`;

// A dropout is a short silence (300-1200ms) WITHIN a spoken response; larger gaps
// are turn/greeting boundaries and must NOT count.
function analyzeAudio(rms) {
  if (!rms || rms.length < 5) return { spoke: false };
  const SP = 0.012, DROP_MIN = 300, DROP_MAX = 1200;
  const active = rms.filter(([, r]) => r > SP);
  if (!active.length) return { spoke: false, maxRms: +Math.max(...rms.map(x => x[1])).toFixed(3) };
  const segs = []; let cur = null, dropouts = 0, maxDropMs = 0, prev = null;
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
  return { spoke: true, segments: segs.length, firstOnsetMs: segs[0].startMs,
           dropouts, maxDropMs, maxRms: +Math.max(...active.map(x => x[1])).toFixed(3) };
}

function parseLatencyS(txt) {
  if (!txt) return null;
  const m = txt.match(/([\d.]+)/); if (!m) return null;
  let v = parseFloat(m[1]);
  if (/\bms\b/i.test(txt)) v /= 1000;
  return v;
}

async function shot(page, file) {
  try { await page.addStyleTag({ content: FREEZE_CSS }); } catch (_) {}
  try { await page.screenshot({ path: file, fullPage: false }); return true; } catch (_) { return false; }
}

function visualDiff(name, curPath) {
  if (!PNG || !pixelmatch) return { name, skipped: 'pixelmatch not installed' };
  const basePath = path.join(BASELINE, `${name}.png`);
  if (UPDATE_BASELINE || !fs.existsSync(basePath)) {
    fs.copyFileSync(curPath, basePath);
    return { name, baseline: UPDATE_BASELINE ? 'updated' : 'created' };
  }
  const cur = PNG.sync.read(fs.readFileSync(curPath));
  const base = PNG.sync.read(fs.readFileSync(basePath));
  if (cur.width !== base.width || cur.height !== base.height)
    return { name, sizeMismatch: `${cur.width}x${cur.height} vs ${base.width}x${base.height}`, ratio: 1, changed: true };
  const diff = new PNG({ width: cur.width, height: cur.height });
  const n = pixelmatch(cur.data, base.data, diff.data, cur.width, cur.height, { threshold: 0.1 });
  const diffPath = path.join(OUT, `${name}.diff.png`);
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  const ratio = n / (cur.width * cur.height);
  return { name, diffPixels: n, ratio: +ratio.toFixed(5), changed: ratio > VIS_THRESHOLD, diffPath: `out/${name}.diff.png` };
}

// ---- collect page signals into a fresh bag per scenario ----
function attach(page, sig) {
  page.on('console', (m) => { if (m.type() === 'error') sig.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => sig.consoleErrors.push('pageerror: ' + String(e).slice(0, 300)));
  page.on('requestfailed', (r) => sig.failedRequests.push(`${r.method()} ${r.url().slice(0, 110)} :: ${r.failure()?.errorText}`));
  page.on('response', (r) => { const s = r.status(); if (s >= 400) sig.badResponses.push(`${s} ${r.url().slice(0, 110)}`); });
  page.on('websocket', (ws) => ws.on('close', (code) => { if (code && code !== 1000 && code !== 1005) sig.wsClosures.push(`ws close ${code}`); }));
}

async function selectAndStart(page, sc) {
  if (sc.example === 'generic') {
    const label = sc.model === 'super' ? 'Try with Nemotron Super' : 'Try with Nemotron Nano';
    const btn = page.getByRole('button', { name: label });
    if (await btn.count()) await btn.first().click();
    else await page.locator('.example-card').first().click();
  } else {
    const omni = page.locator('.example-card').filter({ hasText: /omni/i }).first();
    if (await omni.count()) await omni.click();
    else await page.locator('.example-card').nth(1).click();
  }
  await sleep(400);
  await page.getByRole('button', { name: /start conversation/i }).click({ timeout: 10000 });
}

async function runScenario(sc) {
  const r = { slug: sc.slug, example: sc.example, category: sc.category, budgetS: sc.budgetS,
              hardFails: [], warns: [], consoleErrors: [], failedRequests: [], badResponses: [], wsClosures: [] };
  const MIC = path.join(HERE, sc.mic);
  const browser = await chromium.launch({ headless: true, args: [
    '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${MIC}`, '--autoplay-policy=no-user-gesture-required',
  ]});
  try {
    const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(TAP);
    const page = await ctx.newPage();
    attach(page, r);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1200);
    await selectAndStart(page, sc);
    const tStart = Date.now();

    let connected = false, latencyText = '', caption = '', transcript = '';
    for (let i = 0; i < 80; i++) {                 // up to ~65s
      await sleep(1000);
      caption = (await page.locator('.conv-orb-caption').first().innerText().catch(() => '')) || caption;
      if (!connected && /connected|listening|speaking|thinking/i.test(caption)) {
        connected = true; r.connectMs = Date.now() - tStart;
      }
      const lv = await page.locator('.conv-latency__value').first().innerText().catch(() => '');
      if (lv && lv.trim() !== '—' && /\d/.test(lv)) latencyText = lv.trim();
      transcript = await page.locator('.conv-message-list, .transcript-message').allInnerTexts()
        .then(a => a.join(' | ')).catch(() => '') || transcript;
      if ((latencyText && /bot|speaking/i.test(caption)) || (latencyText && transcript)) break;
    }
    await sleep(1500);
    const audio = await page.evaluate(() => window.__bot).catch(() => null);
    const a = analyzeAudio(audio?.rms);
    const latS = parseLatencyS(latencyText);

    r.connected = connected;
    r.appLatencyS = latS;
    r.botSpoke = !!a.spoke;
    r.audio = a;
    r.transcriptSample = transcript.slice(0, 220);

    // ---- assertions ----
    if (!connected) r.hardFails.push('never connected');
    if (!a.spoke) r.hardFails.push(`no bot audio (maxRms=${a.maxRms ?? 0})`);
    if (latS === null) r.hardFails.push('no end-to-end latency readout (turn incomplete)');
    else if (latS > sc.budgetS) r.hardFails.push(`latency ${latS}s > budget ${sc.budgetS}s`);

    const frameKindErr = r.consoleErrors.find(e => /Unknown frame kind|Failed to deserialize/i.test(e));
    if (frameKindErr) r.hardFails.push(`console: ${frameKindErr.slice(0, 80)}`);
    const otherErrs = r.consoleErrors.filter(e => !/Unknown frame kind|Failed to deserialize/i.test(e));
    if (otherErrs.length) r.hardFails.push(`${otherErrs.length} console error(s): ${otherErrs[0].slice(0, 80)}`);
    if (r.badResponses.length) r.hardFails.push(`${r.badResponses.length} HTTP >=400: ${r.badResponses[0]}`);
    if (r.wsClosures.length) r.hardFails.push(`bad WS close: ${r.wsClosures[0]}`);

    if (a.spoke && a.dropouts) r.warns.push(`${a.dropouts} mid-speech dropout(s) (max ${a.maxDropMs}ms)`);
    if (sc.expect) {
      if (!transcript) r.warns.push('no transcript surfaced (cannot check expected answer)');
      else if (!new RegExp(sc.expect, 'i').test(transcript)) r.warns.push(`answer regex /${sc.expect}/i not found in transcript`);
      else r.answerMatched = true;
    }

    await shot(page, path.join(OUT, `scn_${sc.slug}.png`));

    // End -> thanks modal (best-effort UI check)
    const endBtn = page.locator('.clean-end, button:has-text("End")').first();
    if (await endBtn.count()) { await endBtn.click().catch(() => {}); await sleep(1200);
      r.endedShowsThanks = (await page.getByText(/thank you/i).count()) > 0;
      if (!r.endedShowsThanks) r.warns.push('End did not show thank-you modal'); }
  } catch (e) {
    r.hardFails.push('scenario threw: ' + String(e).slice(0, 200));
  } finally {
    await browser.close();
  }
  r.pass = r.hardFails.length === 0;
  return r;
}

// A dedicated visual pass on the static landing + settings pages (frozen anims).
async function visualPass() {
  const out = { pages: [] };
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream'] });
  try {
    const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(1500);
    const landing = path.join(OUT, 'view_landing.png');
    if (await shot(page, landing)) out.pages.push(visualDiff('landing', landing));
    const gear = page.locator('.icon-btn--settings, [aria-label="Settings"]').first();
    if (await gear.count()) {
      await gear.click().catch(() => {}); await sleep(700);
      const settings = path.join(OUT, 'view_settings.png');
      if (await shot(page, settings)) out.pages.push(visualDiff('settings', settings));
      out.ttsOptions = await page.locator('.set-tts-btn').allInnerTexts().catch(() => []);
    }
  } catch (e) { out.error = String(e).slice(0, 200); }
  finally { await browser.close(); }
  return out;
}

(async () => {
  const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'scenarios.json'), 'utf8'));
  const report = { base: BASE, startedAt: new Date().toISOString(), scenarios: [], visual: null };
  console.log(`\n===== UI SUITE :: ${spec.scenarios.length} scenario(s) vs ${BASE} =====\n`);

  for (const sc of spec.scenarios) {
    process.stdout.write(`  ▶ ${sc.slug.padEnd(18)} (${sc.example}/${sc.category}) ... `);
    const r = await runScenario(sc);
    report.scenarios.push(r);
    const tag = r.pass ? 'PASS' : 'FAIL';
    const lat = r.appLatencyS != null ? `${r.appLatencyS}s` : 'n/a';
    console.log(`${tag}  lat=${lat} spoke=${r.botSpoke ? 'y' : 'n'} conn=${r.connectMs || '?'}ms` +
      (r.hardFails.length ? `\n      HARD: ${r.hardFails.join(' | ')}` : '') +
      (r.warns.length ? `\n      warn: ${r.warns.join(' | ')}` : ''));
  }

  console.log(`\n  ▶ visual diff (landing + settings) ...`);
  report.visual = await visualPass();
  for (const p of report.visual.pages || []) {
    const s = p.skipped ? `skipped (${p.skipped})` : p.baseline ? `baseline ${p.baseline}` :
      `${p.changed ? 'CHANGED' : 'ok'} (${((p.ratio || 0) * 100).toFixed(3)}% px${p.sizeMismatch ? ', ' + p.sizeMismatch : ''})`;
    console.log(`      ${p.name.padEnd(10)} ${s}`);
  }

  const passed = report.scenarios.filter(s => s.pass).length;
  const visChanged = (report.visual.pages || []).filter(p => p.changed).length;
  report.summary = { scenarios: report.scenarios.length, passed, failed: report.scenarios.length - passed,
                     visualChanged: visChanged };
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'suite_report.json'), JSON.stringify(report, null, 2));

  console.log(`\n===== SUMMARY: ${passed}/${report.scenarios.length} scenarios passed` +
    `${visChanged ? `, ${visChanged} visual change(s)` : ''} =====`);
  console.log(`  full report: out/suite_report.json\n`);
  process.exit(report.summary.failed > 0 ? 1 : 0);
})();
