// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Shared browser + voice harness for the SQA suites. Drives the real demo UI in
// a headed Chromium (on Xvfb) whose mic is the PulseAudio virtmic; speaks with
// external TTS; listens to the bot with external ASR + a WebAudio level tap.
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { promisify } from "node:util";
import { synthSpeech, transcribe } from "./audio.mjs";
import { detectAudibleWav } from "./acoustics.mjs";
const execFileP = promisify(execFile);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const BASE = process.env.SQA_BASE || "http://localhost:7862";
export const OUT = process.env.SQA_OUT || "/sqa/out";
export const RUN_ID = process.env.SQA_RUN_ID || "unversioned-run";
export const GENERIC_SERVER_TOOL_NAMES = Object.freeze([
  "get_weather",
  "get_stock_price",
  "web_search",
  "calculate_bmi",
  "generate_random_number",
]);
mkdirSync(OUT, { recursive: true });

// WebAudio tap: records when bot audio starts + a level trace, resettable per turn.
export const TAP = `
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
          window.__bot.rms.push([Math.round(now-window.__bot.t0), +rms.toFixed(4)]);
          if(window.__bot.rms.length>300) window.__bot.rms.shift(); },55);
      } return oc.call(this, ctx.__tap, ...rest); } } catch(e){}
    return oc.call(this, dest, ...rest); }; })();`;

export const FREEZE_CSS = `
*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
.wm-flow { background:#76b900 !important; -webkit-background-clip:initial !important; background-clip:initial !important;
           -webkit-text-fill-color:#76b900 !important; color:#76b900 !important; }`;

const EXPECTED_FORCED_WS_CLOSE_RE =
  /(?:websocket|web socket|transport|connection|session).{0,160}(?:closed|closing|disconnect|ended|lost|abort)|(?:closed|closing|disconnect|ended|lost).{0,160}(?:websocket|web socket|socket|transport|connection|session)|attempt to send to closed socket|fatal error reported\. disconnecting|please call \.begin\(\) first/i;

function recordConsoleDiagnostic(sig, text) {
  const clipped = String(text).slice(0, 300);
  if (sig._expectForcedWebSocketClose && EXPECTED_FORCED_WS_CLOSE_RE.test(clipped)) {
    sig.expectedDiagnostics.push(clipped);
  } else {
    sig.consoleErrors.push(clipped);
  }
}

export function newSignals() {
  return {
    consoleErrors: [], expectedDiagnostics: [], failedRequests: [], badResponses: [], wsClosures: [],
    _expectForcedWebSocketClose: false,
  };
}

export function expectForcedWebSocketClose(sig, enabled = true) {
  sig._expectForcedWebSocketClose = enabled;
}

export function attachSignals(page, sig) {
  page.on("console", (m) => { if (m.type() === "error") recordConsoleDiagnostic(sig, m.text()); });
  page.on("pageerror", (e) => recordConsoleDiagnostic(sig, "pageerror: " + String(e)));
  page.on("requestfailed", (r) => sig.failedRequests.push(`${r.method()} ${r.url().slice(0, 110)} :: ${r.failure()?.errorText}`));
  page.on("response", (r) => { const s = r.status(); if (s >= 400) sig.badResponses.push(`${s} ${r.url().slice(0, 110)}`); });
  // Playwright's ws 'close' event carries no close code, so only socketerror
  // can distinguish a transport fault. Expected forced-drop diagnostics are
  // retained separately; unrelated uncaught errors remain hard failures.
  page.on("websocket", (ws) => ws.on("socketerror", (err) => {
    const diagnostic = `ws socketerror: ${String(err).slice(0, 100)}`;
    if (sig._expectForcedWebSocketClose) sig.expectedDiagnostics.push(diagnostic);
    else sig.wsClosures.push(diagnostic);
  }));
}

export async function launchBrowser({ headless = false, extraArgs = [], env } = {}) {
  return chromium.launch({
    headless,
    ...(env ? { env: { ...process.env, ...env } } : {}),
    args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
      "--disable-gpu", "--disable-dev-shm-usage", ...extraArgs],
  });
}

// Create an isolated per-user audio device set (own mic + speaker) so N browsers
// can speak/listen simultaneously without collision. Launch that user's browser
// with env { PULSE_SOURCE: source, PULSE_SINK: micSink } to bind its default
// devices. Returns device names.
export async function createAudioSlot(i) {
  const micSink = `mic_${i}`, spkSink = `spk_${i}`, source = `vmic_${i}`;
  await execFileP("pactl", ["load-module", "module-null-sink", `sink_name=${micSink}`, `sink_properties=device.description=Mic${i}`]);
  await execFileP("pactl", ["load-module", "module-null-sink", `sink_name=${spkSink}`, `sink_properties=device.description=Spk${i}`]);
  await execFileP("pactl", ["load-module", "module-virtual-source", `source_name=${source}`, `master=${micSink}.monitor`, `source_properties=device.description=VMic${i}`]);
  // A chromium bound via PULSE_SINK=micSink would play the bot into micSink; we
  // want the bot in spkSink, so bind PULSE_SINK=spkSink and PULSE_SOURCE=source.
  return { micSink, spkSink, source, spkMonitor: `${spkSink}.monitor`, env: { PULSE_SOURCE: source, PULSE_SINK: spkSink } };
}

export async function newPage(browser, sig, { viewport = { width: 1280, height: 800 }, recordVideoDir } = {}) {
  const ctx = await browser.newContext({ permissions: ["microphone"], viewport, ...(recordVideoDir ? { recordVideo: { dir: recordVideoDir, size: viewport } } : {}) });
  await ctx.addInitScript(TAP);
  const page = await ctx.newPage();
  if (sig) attachSignals(page, sig);
  return { ctx, page };
}

// Pick an example card on the landing page, which now opens the ExampleConfigModal
// popup (.ex-config). We configure the per-session choices in the popup but do NOT
// launch here — startConversation() clicks the popup's "Start conversation".
//   example : "generic" | "omni"
//   model   : "lightning" only. Generic model roles are fixed; any other value
//             is rejected so a test cannot silently claim it selected Super/Nano.
//   tts     : "magpie" | "chatterbox"          (optional; leaves the popup default if omitted)
//   tools   : string[] of visible tool LABELS to ENABLE on a UI that actually
//             renders tool checkboxes. The Generic Frontend/Backend example owns
//             its fixed allowlist server-side, so callers must use
//             assertServerOwnedTools() and omit this option for that example.
//   reasoning: boolean (optional); explicitly set the popup reasoning toggle.
//              Generic has fixed model roles (Talker reasoning off, Thinker on),
//              so `false` is valid even though that popup has no toggle.
//   consent : check the "Store my audio…" toggle inside the popup.
export async function waitForDeploymentReady(page, { timeoutMs = 30000 } = {}) {
  const cards = page.locator(".example-card");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cards.count() >= 2) return true;
    await sleep(250);
  }
  return false;
}

export async function assertServerOwnedTools(page, {
  pipelineMode = "generic-frontend-backend-agent",
  promptKey = "generic_talker",
  expected = GENERIC_SERVER_TOOL_NAMES,
} = {}) {
  if (!Array.isArray(expected) || expected.length === 0) {
    throw new Error("server-owned tool assertion requires a nonempty expected tool list");
  }
  const endpoint = new URL("/api/prompts", BASE);
  endpoint.searchParams.set("pipeline_mode", pipelineMode);
  const response = await page.request.get(endpoint.toString(), { timeout: 15000 });
  if (!response.ok()) {
    throw new Error(`server-owned tool catalog request failed: HTTP ${response.status()}`);
  }
  const prompts = await response.json();
  if (!Array.isArray(prompts)) throw new Error("server-owned tool catalog response is not an array");
  const prompt = prompts.find((item) => item?.key === promptKey);
  if (!prompt) throw new Error(`server-owned tool prompt not found: ${promptKey}`);
  const actual = Array.isArray(prompt.tools)
    ? [...new Set(prompt.tools.filter((tool) => typeof tool === "string" && tool.trim()).map((tool) => tool.trim()))]
    : [];
  const wanted = [...new Set(expected.map((tool) => String(tool).trim()).filter(Boolean))];
  const actualSet = new Set(actual);
  const wantedSet = new Set(wanted);
  const missing = wanted.filter((tool) => !actualSet.has(tool));
  const unexpected = actual.filter((tool) => !wantedSet.has(tool));
  if (missing.length || unexpected.length) {
    throw new Error(
      `server-owned tool catalog mismatch: missing=[${missing.join(", ")}] unexpected=[${unexpected.join(", ")}]`,
    );
  }
  return actual.sort();
}

export async function selectExample(page, { example = "generic", model = "lightning", tts, tools, reasoning, consent } = {}) {
  const isOmni = /omni/i.test(example);
  if (!(await waitForDeploymentReady(page))) throw new Error("deployment options did not become ready");
  // 1. Click the example card to open its configuration popup.
  const card = page.locator(".example-card").filter({ hasText: isOmni ? /omni/i : /generic/i }).first();
  if (await card.count()) await card.click();
  else await page.locator(".example-card").nth(isOmni ? 1 : 0).click();

  // 2. Wait for the popup to appear (the launch surface).
  const popup = page.locator(".ex-config");
  await popup.waitFor({ state: "visible", timeout: 8000 });

  // 3. Generic model roles are fixed and informational, not selectable.
  if (!isOmni) {
    if (model && model !== "lightning") {
      throw new Error(`Generic model roles are fixed; unsupported requested model: ${model}`);
    }
    const roleText = await popup.locator(".ex-config__section").filter({ hasText: /agent model roles/i }).innerText().catch(() => "");
    if (!/lightning/i.test(roleText) || !/super/i.test(roleText)) {
      throw new Error("fixed Lightning Talker and Super Thinker roles are not rendered");
    }
    if (await popup.locator('input[name="llm"]').count()) {
      throw new Error("Generic fixed model roles unexpectedly became client-selectable");
    }
  }

  // 4. TTS radio (both examples expose it).
  if (tts) {
    const wanted = tts === "chatterbox" ? /chatterbox/i : /magpie/i;
    const opt = popup.locator('label.ex-opt', { has: page.locator('input[name="tts"]') }).filter({ hasText: wanted }).first();
    // The deployment catalog is loaded asynchronously after the modal opens.
    // Keep the requested-option check strict, but allow the matching radio to
    // arrive before treating a missing catalog entry as a hard failure.
    await opt.waitFor({ state: "visible", timeout: 8000 }).catch(() => {
      throw new Error(`requested TTS option not found: ${tts}`);
    });
    await opt.locator("input").evaluate((el) => el.click());
  }

  // 5. Visible tools multi-select, only for surfaces that explicitly render it.
  if (!isOmni && Array.isArray(tools)) {
    const want = new Set(tools.map((t) => t.trim().toLowerCase()));
    const labels = popup.locator("label.ex-tool");
    const n = await labels.count();
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const lbl = labels.nth(i);
      const txt = (await lbl.locator("span").last().innerText().catch(() => "")).trim().toLowerCase();
      const box = lbl.locator('input[type=checkbox]');
      seen.add(txt);
      const checked = await box.isChecked().catch(() => false);
      if (checked !== want.has(txt)) await box.evaluate((el) => el.click()).catch(() => {});
    }
    const missing = [...want].filter((name) => !seen.has(name));
    if (missing.length) throw new Error(`requested tool option(s) not found: ${missing.join(", ")}`);
  }

  // 6. Optional explicit reasoning state, so SQA can qualify both paths.
  const reasoningToggle = popup.locator(".reasoning-toggle input[type=checkbox]");
  const reasoningToggleCount = typeof reasoning === "boolean" ? await reasoningToggle.count() : 0;
  if (typeof reasoning === "boolean" && reasoningToggleCount === 0) {
    if (isOmni || reasoning) throw new Error("reasoning toggle not found");
  } else if (typeof reasoning === "boolean") {
    const cb = reasoningToggle;
    if (reasoningToggleCount !== 1) throw new Error("reasoning toggle is ambiguous");
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await cb.isChecked() === reasoning) break;
      await cb.evaluate((el) => el.click());
      await sleep(150);
    }
    if (await cb.isChecked() !== reasoning) {
      throw new Error("reasoning toggle did not reach requested state: " + reasoning);
    }
  }

  // 7. Consent toggle (inside the popup, may be visually hidden → toggle via the input).
  if (typeof consent === "boolean") {
    const cb = popup.locator(".consent-toggle input[type=checkbox]");
    if (await cb.count() !== 1) throw new Error("consent toggle not found or ambiguous");
    await cb.first().evaluate((el, enabled) => {
      if (el.checked !== enabled) el.click();
    }, consent);
  }
  await sleep(750);
  if (typeof reasoning === "boolean" && reasoningToggleCount === 1) {
    const cb = reasoningToggle;
    if (await cb.isChecked() !== reasoning) {
      await cb.evaluate((el) => el.click());
      await sleep(150);
    }
    if (await cb.isChecked() !== reasoning) {
      throw new Error("reasoning toggle was reset before launch: " + reasoning);
    }
  }
}

export async function startConversation(page, { timeoutMs = 30000 } = {}) {
  // The popup's primary button ("Start conversation" / "Connecting…") launches.
  const btn = page.locator(".ex-config__actions .btn-primary").first();
  if (await btn.count()) await btn.click({ timeout: 10000 });
  else await page.getByRole("button", { name: /start conversation/i }).click({ timeout: 10000 });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(700);
    const cap = await orbCaption(page);
    if (/connected|listening|speaking|thinking/i.test(cap)) return { connected: true, connectMs: Date.now() - t0 };
  }
  return { connected: false, connectMs: null };
}

// Latch every tool name the transient .conv-tool box shows. That box is rendered
// only between the pipeline's `tool-call` and `tool-call-done` events, so a
// MutationObserver is the reliable way to see short-lived tool calls. Install once
// the conversation is live; mark before a turn and read what fired since.
export async function installToolWatch(page) {
  await page.evaluate(() => {
    if (window.__toolWatchInstalled) return;
    window.__toolWatchInstalled = true;
    window.__tools = [];
    window.__activeToolNames = new Set();
    const grab = () => {
      const visible = new Set();
      document.querySelectorAll(".conv-tool__name").forEach((node) => {
        const name = (node.textContent || "").trim();
        if (!name) return;
        visible.add(name);
        if (!window.__activeToolNames.has(name)) window.__tools.push(name);
      });
      window.__activeToolNames = visible;
    };
    new MutationObserver(grab).observe(document.body, { childList: true, subtree: true });
    grab();
  });
}
export const toolWatchMark = (page) => page.evaluate(() => (window.__tools || []).length).catch(() => 0);
export const toolWatchSince = (page, mark) => page.evaluate((m) => (window.__tools || []).slice(m), mark).catch(() => []);

export const orbCaption = (page) => page.locator(".conv-orb-caption").first().innerText().catch(() => "");

// Wait until the app is idle/listening (not mid-greeting/speaking), so our speech lands cleanly.
export async function waitListening(page, { timeoutMs = 14000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const cap = (await orbCaption(page)).toLowerCase();
    if (/listening|connected|ready/.test(cap) && !/speaking|thinking/.test(cap)) return true;
    await sleep(400);
  }
  return false;
}

// Require an idle welcome transcript to remain unchanged long enough for Pipecat
// to finalize the assistant bubble before the first synthetic user turn starts.
export async function waitForSettledWelcome(page, {
  timeoutMs = 45000, stableMs = 2800,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let previous = "";
  let stableSince = 0;
  while (Date.now() < deadline) {
    const messages = await readMessages(page);
    const signature = messages
      .filter((message) => message.role === "bot" && message.text.trim())
      .map((message) => message.text.trim())
      .join("\u0000");
    const caption = (await orbCaption(page)).toLowerCase();
    const listening = /listening|connected|ready/.test(caption)
      && !/speaking|thinking/.test(caption);
    if (signature && listening) {
      if (signature !== previous) {
        previous = signature;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= stableMs) return true;
    } else {
      stableSince = 0;
    }
    await sleep(250);
  }
  return false;
}

export async function readMessages(page) {
  return page.$$eval(".transcript-message", (els) => els.map((el) => ({
    role: el.classList.contains("message-user") ? "user" : "bot",
    text: (el.querySelector(".message-content span:last-child")?.textContent || el.textContent || "").trim(),
  })));
}

async function waitForUserTranscriptSince(page, fromMessageCount, timeoutMs = 8000) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  while (Date.now() < deadline) {
    const messages = (await readMessages(page)).slice(fromMessageCount);
    const userTexts = messages.filter((message) => message.role === "user").map((message) => message.text).filter(Boolean);
    if (userTexts.length) {
      return { received: true, elapsedMs: Date.now() - startedAt, messages: userTexts };
    }
    await sleep(100);
  }
  return { received: false, elapsedMs: null, messages: [] };
}

export const latencyText = (page) => page.locator(".conv-latency__value").first().innerText().catch(() => "");
export function parseLatencyS(txt) {
  if (!txt) return null; const m = txt.match(/([\d.]+)/); if (!m) return null;
  let v = parseFloat(m[1]); if (/\bms\b/i.test(txt)) v /= 1000; return v;
}

// Speak `text` into the virtual mic (the app hears it via virtmic). For video
// runs, echoToSpk also plays it into spk_sink so the user's voice is captured in
// the screen recording (which records spk_sink.monitor).
async function playSpeechWav(outWav, { echoToSpk = false, micDevice = "mic_sink", spkDevice = "spk_sink" } = {}) {
  const devices = echoToSpk ? [micDevice, spkDevice] : [micDevice];
  await Promise.all(devices.map((d) => execFileP("paplay", [`--device=${d}`, outWav])));
}

export async function speak(text, name, { voice, echoToSpk = false, micDevice = "mic_sink", spkDevice = "spk_sink" } = {}) {
  const { outWav, durationSec } = await synthSpeech(text, `${OUT}/${name}.wav`, { voice });
  await playSpeechWav(outWav, { echoToSpk, micDevice, spkDevice });
  return { outWav, durationSec };
}

// Record spk_sink.monitor until the bot has been quiet for quietMs (after onset), or maxMs.
export async function captureBot(page, name, {
  maxMs = 25000,
  quietMs = 1700,
  monitor = "spk_sink.monitor",
  requireListening = false,
  settleFromMessageCount = null,
  stableMs = 2800,
  allowTranscriptOnlyStop = true,
  nonTerminalBotTexts = [],
} = {}) {
  const out = `${OUT}/${name}.wav`;
  const rec = execFile("ffmpeg", ["-y", "-f", "pulse", "-i", monitor, "-ac", "1", "-ar", "16000", out]);
  const t0 = Date.now(); let lastLoud = Date.now(), sawOnset = false, onsetAt = null;
  let transcriptSignature = "", transcriptStableSince = t0;
  let sawNewBotMessage = false, sawTerminalBotMessage = false;
  const ignoredBotTexts = new Set(nonTerminalBotTexts.map((text) => text.trim().toLowerCase().replace(/\s+/g, " ")));
  while (Date.now() - t0 < maxMs) {
    await sleep(200);
    const b = await page.evaluate(() => window.__bot).catch(() => null);
    if (b?.onsetMs != null && !sawOnset) { sawOnset = true; onsetAt = Date.now(); }
    const recent = (b?.rms || []).slice(-8);
    if (recent.some(([, r]) => r > 0.012)) lastLoud = Date.now();
    let transcriptSettled = settleFromMessageCount === null;
    if (settleFromMessageCount !== null) {
      const state = await page.evaluate((from) => {
        const messages = [...document.querySelectorAll(".transcript-message")].slice(from);
        const bot = messages.filter((el) => !el.classList.contains("message-user"));
        const signature = bot.map((el) => (
          el.querySelector(".message-content span:last-child")?.textContent || el.textContent || ""
        ).trim()).join("\u0000");
        return {
          activeTool: document.querySelectorAll(".conv-tool__name").length > 0,
          hasBot: bot.some((el) => (el.textContent || "").trim()),
          botTexts: bot.map((el) => (
            el.querySelector(".message-content span:last-child")?.textContent || el.textContent || ""
          ).trim()),
          signature,
        };
      }, settleFromMessageCount).catch(() => ({ activeTool: true, hasBot: false, botTexts: [], signature: "" }));
      sawNewBotMessage ||= state.hasBot;
      sawTerminalBotMessage ||= state.botTexts.some((text) => (
        text && !ignoredBotTexts.has(text.toLowerCase().replace(/\s+/g, " "))
      ));
      if (state.signature !== transcriptSignature) {
        transcriptSignature = state.signature;
        transcriptStableSince = Date.now();
      }
      transcriptSettled = sawNewBotMessage && sawTerminalBotMessage && !state.activeTool
        && Date.now() - transcriptStableSince >= stableMs;
    }
    if (sawOnset && Date.now() - lastLoud > quietMs) {
      const caption = (await orbCaption(page)).toLowerCase();
      const listening = /listening|connected|ready/.test(caption)
        && !/speaking|thinking/.test(caption);
      if ((!requireListening || listening) && transcriptSettled) break;
    }
    // The browser tap can miss audio when Chromium builds its destination
    // graph before our hook attaches. A settled transcript plus an idle orb is
    // enough to stop recording; the WAV oracle below still decides whether
    // actual bot speech exists, so transcript-only failures cannot pass.
    if (!sawOnset && requireListening && transcriptSettled && allowTranscriptOnlyStop) {
      const caption = (await orbCaption(page)).toLowerCase();
      const listening = /listening|connected|ready/.test(caption)
        && !/speaking|thinking/.test(caption);
      if (listening) break;
    }
  }
  rec.kill("SIGINT");
  await new Promise((r) => rec.on("exit", r));
  const webSawOnset = sawOnset;
  const acoustic = await detectAudibleWav(out);
  sawOnset = acoustic.audible;
  return {
    out,
    sawOnset,
    responseMs: sawOnset && onsetAt ? onsetAt - t0 : null,
    onsetSource: sawOnset ? (webSawOnset ? "webaudio+acoustic" : "acoustic") : "none",
    acousticMaxVolumeDb: acoustic.maxVolumeDb,
    acousticError: acoustic.error,
  };
}

// One full spoken turn: wait to be listening, speak, capture the bot, ASR it, read DOM.
export async function turn(page, text, name, {
  voice, transcribeBot = true, echoToSpk = false, micDevice, spkDevice, monitor, settle = false, settleStableMs = 4500,
  speechEngine, speechInstructions, nonTerminalBotTexts,
} = {}) {
  await waitListening(page);
  await page.evaluate(() => window.__botReset());
  const before = (await readMessages(page)).length;
  const t0 = Date.now();
  const { outWav } = await synthSpeech(text, `${OUT}/${name}_user.wav`, {
    voice, engine: speechEngine, instructions: speechInstructions,
  });
  const captureOptions = monitor ? { monitor } : {};
  if (settle) Object.assign(captureOptions, {
    maxMs: 75000, quietMs: 2000, requireListening: true,
    settleFromMessageCount: before, stableMs: settleStableMs, nonTerminalBotTexts,
  });
  // Arm the recorder before playing the user WAV. Fast model/TTS responses can
  // otherwise begin before FFmpeg opens the per-browser speaker monitor.
  const capturePromise = captureBot(page, `${name}_bot`, captureOptions);
  const inputPromise = waitForUserTranscriptSince(page, before);
  await sleep(150);
  await playSpeechWav(outWav, {
    echoToSpk,
    ...(micDevice ? { micDevice } : {}),
    ...(spkDevice ? { spkDevice } : {}),
  });
  const cap = await capturePromise;
  const input = await inputPromise;
  if (settle) {
    await waitListening(page, { timeoutMs: 15000 });
    await sleep(300);
  }
  const wallMs = Date.now() - t0;
  let botAsr = "", botAsrError = "";
  if (cap.sawOnset && transcribeBot) {
    try { botAsr = await transcribe(cap.out); }
    catch (e) { botAsrError = String(e?.message || e); }
  }
  const msgs = await readMessages(page);
  const newMsgs = msgs.slice(before);
  const domBot = [...newMsgs].reverse().find((m) => m.role === "bot")?.text || "";
  const domUserMessages = newMsgs.filter((m) => m.role === "user").map((m) => m.text).filter(Boolean);
  const domUser = domUserMessages.join(" ").replace(/\\s+/g, " ").trim();
  return { user: text, inputReceived: input.received, inputReceivedMs: input.elapsedMs,
           botSpoke: cap.sawOnset, botAsr, botAsrError, domUser, domUserMessages, domBot, newMessages: newMsgs, responseMs: cap.responseMs,
           wallMs, latencyS: parseLatencyS(await latencyText(page)), wav: cap.out };
}

export const sessionId = (page) => page.locator(".conv-session-id code").innerText().then((t) => t.trim()).catch(() => "");

// --- Media injection + capture introspection (in-page fetch, so it rides the app
// origin/cookies exactly like the UI). `buf` is a Node Buffer. ---
async function postFile(page, url, buf, { name, type, field = "file", extraFields } = {}) {
  return page.evaluate(async ({ url, b64, name, type, field, extraFields }) => {
    try {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const fd = new FormData();
      fd.append(field, new Blob([bin], { type }), name);
      for (const [k, v] of Object.entries(extraFields || {})) fd.append(k, v);
      const res = await fetch(url, { method: "POST", body: fd });
      return { status: res.status, body: (await res.text()).slice(0, 240) };
    } catch (e) { return { status: 0, body: String(e) }; }
  }, { url, b64: buf.toString("base64"), name, type, field, extraFields });
}

// POST an image to the attachment store (Omni media understanding path).
export const uploadAttachment = (page, sid, buf, { name = "image.png", type = "image/png", kind = "image" } = {}) =>
  postFile(page, `/api/sessions/${sid}/attachments?kind=${kind}`, buf, { name, type });

// POST a webcam frame (simulate the browser webcam feed). Server field is "file",
// filename webcam-frame.jpg, content-type image/jpeg (see api.ts uploadWebcamFrame).
export const uploadWebcamFrame = (page, sid, buf, { name = "webcam-frame.jpg", type = "image/jpeg" } = {}) =>
  postFile(page, `/api/sessions/${sid}/webcam/frames`, buf, { name, type });

// GET /api/session-capture/status — introspect the capture PVC (files/tarballs).
export const sessionCaptureStatus = (page) =>
  page.evaluate(async () => {
    try { const r = await fetch("/api/session-capture/status"); return { status: r.status, json: await r.json() }; }
    catch (e) { return { status: 0, json: { error: String(e) } }; }
  });

// Open the mid-conversation Settings (⚙) or Pipeline info (ⓘ) overlay. These do
// NOT disconnect the live session (only the brand/End button does).
export async function openOverlay(page, which) {
  const sel = which === "settings" ? '.icon-btn--settings, [aria-label="Settings"]' : '[aria-label="Pipeline info"]';
  await page.locator(sel).first().click();
  const label = which === "settings" ? "Settings" : "Pipeline info";
  const overlay = page.locator(`.page-overlay[aria-label="${label}"]`);
  await overlay.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
  return (await overlay.count()) > 0;
}

export async function closeOverlay(page) {
  // SettingsPage uses aria-label="Close settings"; PipelineInfo uses "Close" (× + foot button).
  const close = page.locator('.page-overlay .page-panel [aria-label^="Close"], .page-overlay .page-panel button:has-text("Close")').first();
  if (await close.count()) await close.click().catch(() => {});
  await sleep(300);
  return (await page.locator(".page-overlay").count()) === 0;
}

// Dismiss the post-session FeedbackModal ("Thank you!") to return to the landing.
export async function dismissFeedback(page) {
  const close = page.locator('.demo-modal-close, [aria-label="Close and return home"]').first();
  if (await close.count()) { await close.click().catch(() => {}); await sleep(500); }
  return (await page.locator(".example-card").count()) > 0;
}

export async function endConversation(page) {
  const endBtn = page.locator('.clean-end, button:has-text("End")').first();
  if (!(await endBtn.count())) return { ended: false, thanks: false };
  await endBtn.click().catch(() => {});
  // Graceful teardown holds an "Ending…" buffering window (~1.5s) before the modal.
  let thanks = false;
  for (let i = 0; i < 40; i++) {
    if ((await page.getByText(/thank you|connection lost/i).count()) > 0) { thanks = true; break; }
    await sleep(150);
  }
  return { ended: true, thanks };
}

export async function shot(page, file, { freeze = false } = {}) {
  if (freeze) await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
  return page.screenshot({ path: file }).then(() => true).catch(() => false);
}
