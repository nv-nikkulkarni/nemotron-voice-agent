// SPDX-License-Identifier: BSD-2-Clause
// Focused live acceptance for the demo feedback. Raw audio stays in SQA_OUT.
// SQA_VOICE_SAMPLE must name a 3–10-second speech sample when qualifying cloning.
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as H from "./lib/harness.mjs";
import { synthSpeech, wavDuration } from "./lib/audio.mjs";
const exec = promisify(execFile);
const result = { runId: H.RUN_ID, conversations: [], sessionConfigs: [], hardFails: [] };
const signals = H.newSignals();
const slot = await H.createAudioSlot(91);
const browser = await H.launchBrowser({ env: slot.env });
const { page } = await H.newPage(browser, signals, { timezoneId: "Asia/Kolkata" });
page.on("request", (request) => {
  if (!request.url().endsWith("/api/session-config") || request.method() !== "POST") return;
  const config = request.postDataJSON();
  // Record the contract, never reference audio or private prompt contents.
  result.sessionConfigs.push({
    pipeline: config.pipeline_mode, timezone: config.client_timezone,
    frontendEdited: Boolean(config.prompt_content), backendEdited: Boolean(config.thinker_prompt_content),
    persistent: config.persistent_prompt === "Use calm, friendly language for this demo.",
    sampleBytes: config.tts_voice_sample?.length ?? 0, voiceId: config.tts_voice_id,
  });
});
const turns = [
  { text: "What is the current NVIDIA stock price?", heard: /nvidia/i, expect: /price|dollar|USD|\d/i },
  { text: "Check that same company again please.", heard: /company|again/i, expect: /nvidia|NVDA/i },
  { text: "What time is it right now?", heard: /time/i, expect: /\d{1,2}:\d{2}\s*(AM|PM)/i, clock: true },
  { text: "Show me your architecture.", heard: /show\s+me\s+your\s+architecture/i, expect: /architecture|diagram|design/i, architecture: "generic" },
  { text: "Please say Nemotron 3 Diarization.", heard: /nemotron|diarization/i, expect: /^Nemotron 3 Diarization[.!]?$/i },
  { text: "Please repeat these two words: Codex and spinner.", heard: /codex.*spinner/i, expect: /codex.*spinner/i },
  { text: "What can you do?", heard: /what|can|do/i, expect: /help|weather|stock|question|time/i, wordLimit: 25 },
  { text: "Tell me about Sales Cloud.", heard: /sales.*cloud/i, expect: /sales|leads|customer|CRM/i, wordLimit: 35 },
  { text: "Tell me about speaker diarization.", heard: /speaker|diarization/i, expect: /speaker|who.*sp|voice/i, wordLimit: 35 },
  { text: "How are you?", heard: /how.*you/i, expect: /well|good|ready|help|Nemotron/i, wordLimit: 35 },
];
async function voicePreview() {
  const studio = page.locator(".agent-studio .voice-studio");
  await studio.locator('input[name="tts-voice"]').first().waitFor();
  const voices = await studio.locator('input[name="tts-voice"]').evaluateAll((inputs) => inputs.map((input) => input.value));
  assert(voices.length >= 2, "voice catalog must offer multiple voices");
  for (const id of (voices.filter((v) => /\.(Aria|Diego)$/.test(v)).length >= 2 ? voices.filter((v) => /\.(Aria|Diego)$/.test(v)) : voices).slice(0, 2)) {
    await studio.locator(`input[name="tts-voice"][value="${id}"]`).check();
    const response = page.waitForResponse((r) => r.url().endsWith("/api/tts/preview") && r.request().method() === "POST");
    await studio.getByRole("button", { name: "Preview voice", exact: true }).click();
    const preview = await response;
    assert.equal(preview.status(), 200);
    // Chromium's DevTools body API can return "null" for audio resources even
    // when Content-Length is correct. Verify the actual Blob used by the player.
    await studio.locator("audio").waitFor({ state: "visible", timeout: 10000 });
    const played = await studio.locator("audio").evaluate(async (element) => {
      const bytes = new Uint8Array(await (await fetch(element.src)).arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return { audio: btoa(binary), bytes: bytes.length };
    });
    const audio = Buffer.from(played.audio, "base64");
    assert(audio.length > 1000 && audio.subarray(0, 4).toString() === "RIFF", "preview player received invalid WAV");
    fs.writeFileSync(`${H.OUT}/preview-${voices.indexOf(id)}.wav`, audio);
    console.log("Preview passed", id, played.bytes, "bytes");
    await page.waitForFunction(() => !document.querySelector(".voice-studio audio")?.paused);
    await page.evaluate(() => document.querySelectorAll("audio").forEach((a) => a.pause()));
  }
}
async function runTurn(rep, turn, index, inputWav) {
  const started = Date.now();
  const response = await H.turn(page, turn.text, `${rep.key}-${index}`, {
    micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor,
    settle: true, inputWav,
  });
  rep.turns.push(response);
  assert(response.botSpoke, `turn ${index} has no audible response`);
  assert(turn.heard.test(response.domUser), `turn ${index} ASR: ${response.domUser}`);
  assert(turn.expect.test(response.domBot || response.botAsr), `turn ${index} answer: ${response.domBot}`);
  assert(!/\*\*|__|`|asterisk|backtick|full stop|exclamation mark/i.test(response.domBot + response.botAsr), "formatting leaked into speech");
  if (turn.clock) {
    assert(!/\bslash\b|(?:Asia|America|Europe|Africa|Pacific|Australia)\//i.test(response.domBot + response.botAsr),
      "clock speech must use a spoken zone label rather than an IANA separator");
    const time = (response.domBot || response.botAsr).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    assert(time, "clock response must include an actual time");
    const spoken = (+time[1] % 12) * 60 + +time[2] + (time[3].toUpperCase() === "PM" ? 720 : 0);
    const minutes = (date) => {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Calcutta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
      return +parts.find((p) => p.type === "hour").value * 60 + +parts.find((p) => p.type === "minute").value;
    };
    assert([minutes(started), minutes(Date.now())].some((actual) => Math.abs(actual - spoken) <= 1),
      "spoken clock must match fresh browser-local time");
  }
  if (turn.wordLimit) {
    const words = response.domBot.trim().split(/\s+/).filter(Boolean).length;
    assert(words > 0 && words <= turn.wordLimit, `default answer exceeds the spoken word budget: ${words}/${turn.wordLimit}`);
  }
  if (turn.architecture) {
    const image = page.locator(".architecture-presentation img");
    await image.waitFor({ state: "visible", timeout: 5000 });
    assert((await image.getAttribute("src")).endsWith(`/${turn.architecture}.svg`));
    assert(await image.evaluate((img) => img.complete && img.naturalWidth > 0));
    await H.shot(page, `${H.OUT}/${rep.key}-architecture.png`);
    await page.getByRole("button", { name: "Close image" }).click();
  }
  console.log(`${rep.key} turn ${index}: ${response.domUser} => ${response.domBot}`);
}
async function finish(rep) {
  rep.sessionId = await H.sessionId(page);
  assert(rep.sessionId);
  await H.endConversation(page);
  rep.teardown = await page.evaluate(() => window.__session);
  assert(rep.teardown?.lastTeardown?.captureFlushed, "capture POST was not acknowledged");
  await H.dismissFeedback(page);
  rep.pass = true;
}
try {
  await page.goto(H.BASE);
  await H.selectExample(page, { consent: true });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Prompts", exact: true }).click();
  const editor = page.locator(".prompt-studio textarea");
  await editor.nth(1).waitFor({ state: "visible" });
  const backend = await editor.nth(1).inputValue();
  const persona = "You are Lantern, a friendly Halloween host. Keep your spoken replies brief.";
  await editor.nth(0).fill(persona);
  await editor.nth(1).fill(backend + "\nKeep all tool plans strict JSON.");
  await editor.nth(2).fill("Use calm, friendly language for this demo.");
  await page.reload();
  await page.locator(".prompt-studio label").filter({ hasText: "Backend system prompt · planning and tools" }).locator("textarea").waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await editor.nth(0).inputValue(), persona);
  assert((await editor.nth(1).inputValue()).endsWith("Keep all tool plans strict JSON."));
  assert.equal(await editor.nth(2).inputValue(), "Use calm, friendly language for this demo.");
  await H.shot(page, `${H.OUT}/prompts.png`);
  await page.getByRole("button", { name: "Back to setup" }).click();
  await H.selectExample(page, { consent: true });
  await page.getByRole("button",{name:"Voice",exact:true}).click();
  await voicePreview();
  await page.locator('input[name="tts-voice"][value="Magpie-Multilingual.EN-US.Aria"]').check();
  await page.getByRole("button",{name:"Back to setup",exact:true}).click();
  const generic = { key: "generic", turns: [] }; result.conversations.push(generic);
  assert((await H.startConversation(page)).connected);
  assert.deepEqual(result.sessionConfigs.at(-1), { pipeline: "generic-frontend-backend-agent",
    timezone: "Asia/Calcutta", frontendEdited: true, backendEdited: true, persistent: true, sampleBytes: 0, voiceId: "Magpie-Multilingual.EN-US.Aria" });
  assert(await H.waitForSettledWelcome(page));
  assert.equal(await page.getByRole("button", { name: "Prompts", exact: true }).count(), 0);
  for (let index = 0; index < turns.length; index++) {
    await runTurn(generic, turns[index], index + 1);
    if (index === 4) {
      await page.getByRole("button", { name: "Audio settings", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Settings", exact: true });
      assert.equal(await settings.getByRole("combobox").count(), 2, "Settings must expose only audio device controls");
      assert.equal(await settings.locator(".voice-studio").count(), 0);
      assert.equal(await settings.getByRole("radio").count(), 0);
      assert.equal(await settings.getByRole("checkbox").count(), 0);
      await settings.getByRole("button", { name: "Close settings", exact: true }).click();
    }
  }
  // Trim only detected edge silence and create a reproducible 1.7-second unfinished pause.
  const first = `${H.OUT}/pause-first.wav`, last = `${H.OUT}/pause-last.wav`, joined = `${H.OUT}/pause-user.wav`;
  await synthSpeech("Could you check the weather", first); await synthSpeech("in Tokyo right now?", last);
  async function speechBounds(path) {
    const seconds = await wavDuration(path);
    const detection = await exec("ffmpeg", ["-hide_banner", "-i", path, "-af",
      "silencedetect=noise=-35dB:d=0.02", "-f", "null", "-"]);
    const gaps = [...detection.stderr.matchAll(/silence_end:\s*([\d.]+).*silence_duration:\s*([\d.]+)/g)]
      .map((match) => ({ end: +match[1], start: +match[1] - +match[2] }));
    const leading = gaps.find((gap) => gap.start < 0.01);
    const trailing = gaps.find((gap) => gap.end > seconds - 0.01);
    return { start: Math.max(0, (leading?.end ?? 0) - 0.04), end: Math.min(seconds, (trailing?.start ?? seconds) + 0.04) };
  }
  const firstBounds = await speechBounds(first), lastBounds = await speechBounds(last);
  await exec("ffmpeg", ["-y", "-i", first, "-i", last, "-filter_complex",
    `[0:a]atrim=start=${firstBounds.start}:end=${firstBounds.end},asetpts=PTS-STARTPTS,apad=pad_dur=1.62[a];` +
    `[1:a]atrim=start=${lastBounds.start}:end=${lastBounds.end},asetpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=0:a=1[out]`,
    "-map", "[out]", joined]);
  const detection = await exec("ffmpeg", ["-hide_banner", "-i", joined, "-af",
    "silencedetect=noise=-35dB:d=0.08", "-f", "null", "-"]);
  const duration = await wavDuration(joined);
  const interiorSilences = [...detection.stderr.matchAll(/silence_end:\s*([\d.]+).*silence_duration:\s*([\d.]+)/g)]
    .map((match) => ({ end: +match[1], duration: +match[2] }))
    .filter((gap) => gap.end - gap.duration > 0.05 && gap.end < duration - 0.05);
  generic.pauseTiming = { targetSeconds: 1.7, insertedSeconds: 1.62, measuredSeconds: Math.max(...interiorSilences.map((gap) => gap.duration)), thresholdDb: -35 };
  assert(generic.pauseTiming.measuredSeconds >= 1.65 && generic.pauseTiming.measuredSeconds <= 1.8, "fixture must reproduce the observed premature-turn pause");
  await H.installToolWatch(page);
  // Record public stage IDs; UI bubbles alone can hide separate backend turns.
  await page.evaluate(() => {
    window.__frontendSelections = [];
    window.addEventListener("nva:frontend-selection", (event) => {
      window.__frontendSelections.push(event.detail);
    });
  });
  const toolMark = await H.toolWatchMark(page);
  await runTurn(generic, { text: "Could you check the weather [pause] in Tokyo right now?", heard: /weather.*tokyo/i,
    expect: /tokyo|degree|celsius/i }, 8, joined);
  assert.equal(generic.turns.at(-1).domUserMessages.length, 1, "mid-sentence pause split the user turn");
  const pause = generic.turns.at(-1);
  assert(pause.responseMs >= duration * 1000, "assistant audio began before the full user utterance finished");
  assert(!/pune|nairobi|reykjavik/i.test(pause.domBot + pause.botAsr), "example city leaked into the current weather turn");
  generic.pauseTools = await H.toolWatchSince(page, toolMark);
  assert.deepEqual(generic.pauseTools, ["get_weather"], "pause must produce exactly one actual weather execution");
  generic.pauseFrontendTurns = await page.evaluate(() => [...new Set(window.__frontendSelections.map((metric) => metric.turnId))]);
  assert.equal(generic.pauseFrontendTurns.length, 1, "pause must produce exactly one correlated frontend request; missing metrics fail");
  console.log("Pause timing", JSON.stringify(generic.pauseTiming), "one correlated frontend turn and weather execution");
  await finish(generic);
  await page.getByRole("button", { name: "Prompts", exact: true }).click();
  await page.getByRole("button", { name: "Restore frontend default", exact: true }).click();
  await page.getByRole("button", { name: "Restore backend default", exact: true }).click();
  assert.equal(await editor.nth(2).inputValue(), "Use calm, friendly language for this demo.");
  await page.getByRole("button", { name: "Back to setup" }).click();
  await H.selectExample(page, { example: "omni", model: null, consent: true });
  const omni = { key: "omni", turns: [] }; result.conversations.push(omni);
  assert((await H.startConversation(page)).connected); assert(await H.waitForSettledWelcome(page));
  await runTurn(omni, { text: "Show me your architecture.", heard: /show\s+me\s+your\s+architecture/i, expect: /architecture|diagram|design/i,
    architecture: "omni" }, 1);
  await finish(omni);
  if (process.env.SQA_VOICE_SAMPLE) {
    await H.selectExample(page, { consent: true, tts: "zeroshot" });
    await page.getByRole("button",{name:"Voice",exact:true}).click();
    const studio = page.locator(".agent-studio .voice-studio");
    await studio.locator('input[type="file"]').setInputFiles(process.env.SQA_VOICE_SAMPLE);
    await studio.getByLabel("Use sample for zero-shot voice").check();
    for (const voice of await studio.locator('input[name="tts-voice"]').all()) assert(await voice.isDisabled());
    await page.getByRole("button",{name:"Back to setup",exact:true}).click();
    const clone = { key: "clone", turns: [] }; result.conversations.push(clone);
    assert((await H.startConversation(page)).connected);
    const config = result.sessionConfigs.at(-1);
    assert(!config.frontendEdited && !config.backendEdited && config.persistent && config.sampleBytes > 1000,
      "restored defaults must preserve persistent instructions and the enabled voice sample");
    assert(await H.waitForSettledWelcome(page));
    await runTurn(clone, { text: "Welcome me to your Halloween party in one sentence.", heard: /halloween|party/i,
      expect: /welcome|halloween|party/i }, 1);
    await runTurn(clone, { text: "Please say Nemotron 3 Diarization.", heard: /nemotron|diarization/i,
      expect: /^Nemotron 3 Diarization[.!]?$/i }, 2);
    await finish(clone);
  }
} catch (error) { result.hardFails.push(error.stack || String(error)); }
finally {
  await H.shot(page, `${H.OUT}/final.png`);
  if (result.hardFails.length && await page.locator(".clean-end").count()) {
    result.failedSessionId = await H.sessionId(page);
    await H.endConversation(page);
    result.failedTeardown = await page.evaluate(() => window.__session);
  }
  await browser.close();
  result.signals = signals;
  for (const key of ["consoleErrors", "badResponses", "wsClosures"]) {
    if (signals[key].length) result.hardFails.push(`${key}: ${signals[key].join("; ")}`);
  }
  result.pass = result.hardFails.length === 0;
  fs.writeFileSync(`${H.OUT}/demo-feedback-report.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ pass: result.pass, hardFails: result.hardFails }));
  process.exitCode = result.pass ? 0 : 1;
}
