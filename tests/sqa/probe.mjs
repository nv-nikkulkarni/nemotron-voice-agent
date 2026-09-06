// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Layer-2 probe: one real spoken turn through the live deployment.
//  launch headed Chromium (Xvfb) whose mic = mic_sink.monitor -> start a generic
//  session -> paplay a TTS utterance into mic_sink -> confirm the app connects,
//  its ASR hears us (DOM transcript), the bot speaks (WebAudio tap), and we can
//  ASR the bot's audio off spk_sink.monitor.
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { synthSpeech, transcribe } from "./lib/audio.mjs";
const execFileP = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.env.SQA_BASE || "http://localhost:7862";

const TAP = `
window.__bot = { t0: performance.now(), onsetMs: null, rms: [] };
window.__botReset = () => { window.__bot.onsetMs=null; window.__bot.rms=[]; window.__bot.t0=performance.now(); };
(function(){
  const oc = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(dest, ...rest){
    try { if (dest instanceof AudioDestinationNode){ const ctx=dest.context;
      if(!ctx.__tap){ const an=ctx.createAnalyser(); an.fftSize=1024; an.__buf=new Float32Array(an.fftSize);
        oc.call(an,ctx.destination); ctx.__tap=an;
        setInterval(()=>{ an.getFloatTimeDomainData(an.__buf); let s=0; for(const v of an.__buf)s+=v*v;
          const rms=Math.sqrt(s/an.__buf.length), now=performance.now();
          if(rms>0.008 && window.__bot.onsetMs===null) window.__bot.onsetMs=now;
          window.__bot.rms.push([Math.round(now-window.__bot.t0), +rms.toFixed(4)]); },25);
      } return oc.call(this, ctx.__tap, ...rest); } } catch(e){}
    return oc.call(this, dest, ...rest); }; })();`;

async function speak(text, name) {
  const { outWav } = await synthSpeech(text, `/sqa/out/${name}.wav`);
  await execFileP("paplay", ["--device=mic_sink", outWav]);
  return outWav;
}

// Record spk_sink.monitor until the bot has been quiet for `quietMs`, or maxMs.
async function captureBot(page, name, { maxMs = 22000, quietMs = 1600 } = {}) {
  const out = `/sqa/out/${name}.wav`;
  const rec = execFile("ffmpeg", ["-y", "-f", "pulse", "-i", "spk_sink.monitor", "-ac", "1", "-ar", "16000", out]);
  const t0 = Date.now();
  let lastLoud = Date.now(), sawOnset = false;
  while (Date.now() - t0 < maxMs) {
    await sleep(200);
    const b = await page.evaluate(() => window.__bot).catch(() => null);
    if (b?.onsetMs != null) sawOnset = true;
    const recent = (b?.rms || []).slice(-8);
    if (recent.some(([, r]) => r > 0.012)) lastLoud = Date.now();
    if (sawOnset && Date.now() - lastLoud > quietMs) break;
  }
  rec.kill("SIGINT");
  await new Promise((r) => rec.on("exit", r));
  return { out, sawOnset };
}

async function main() {
  const r = { steps: [], consoleErrors: [], bad: [] };
  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--disable-gpu"],
  });
  const ctx = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(TAP);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") r.consoleErrors.push(m.text().slice(0, 200)); });
  page.on("response", (res) => { if (res.status() >= 400) r.bad.push(`${res.status()} ${res.url().slice(0, 90)}`); });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(1500);
  // generic-assistant, Super
  const superBtn = page.getByRole("button", { name: "Try with Nemotron Super" });
  if (await superBtn.count()) await superBtn.first().click();
  else await page.locator(".example-card").first().click();
  await sleep(400);
  await page.getByRole("button", { name: /start conversation/i }).click();

  // wait to connect
  let connected = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const cap = await page.locator(".conv-orb-caption").first().innerText().catch(() => "");
    if (/connected|listening|speaking|thinking/i.test(cap)) { connected = true; break; }
  }
  r.steps.push(`connected=${connected}`);
  if (!connected) { console.log(JSON.stringify(r, null, 2)); await browser.close(); process.exit(1); }

  await sleep(1500);
  await page.evaluate(() => window.__botReset());
  const utter = "What is the weather in Tokyo right now?";
  console.log(`[probe] speaking: "${utter}"`);
  await speak(utter, "probe_user");
  const { out, sawOnset } = await captureBot(page, "probe_bot");
  const botHeard = sawOnset ? await transcribe(out).catch((e) => `ASR-error:${e.message}`) : "(no bot audio)";
  const dom = await page.locator(".conv-message-list, .transcript-message").allInnerTexts().then((a) => a.join(" | ")).catch(() => "");

  r.steps.push(`botSpoke=${sawOnset}`);
  r.userSaid = utter;
  r.botHeardByExternalASR = botHeard;
  r.domTranscript = dom.slice(0, 400);
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
  process.exit(sawOnset ? 0 : 1);
}
main().catch((e) => { console.error("[probe] ERROR", e); process.exit(1); });
