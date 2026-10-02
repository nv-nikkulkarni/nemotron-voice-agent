// SPDX-License-Identifier: BSD-2-Clause
// Focused live acceptance for the demo feedback. Raw audio stays in SQA_OUT.
// SQA_VOICE_SAMPLE must name a 3–10-second speech sample when qualifying cloning.
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as H from "./lib/harness.mjs";
import { synthSpeech } from "./lib/audio.mjs";
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
    sampleBytes: config.tts_voice_sample?.length ?? 0,
  });
});
const turns = [
  { text: "What is the current NVIDIA stock price?", heard: /nvidia/i, expect: /price|dollar|USD|\d/i },
  { text: "Check that same company again please.", heard: /company|again/i, expect: /nvidia|NVDA/i },
  { text: "What time is it right now?", heard: /time/i, expect: /\d|o.clock|AM|PM/i },
  { text: "Show me your architecture.", heard: /architecture/i, expect: /architecture|diagram|design/i, architecture: "generic" },
  { text: "Please say Nemotron 3 Diarization.", heard: /nemotron|diarization/i, expect: /nemotron|diarization/i },
  { text: "Please repeat these two words: Codex and spinner.", heard: /codex.*spinner/i, expect: /codex.*spinner/i },
  { text: "What can you do?", heard: /what|can|do/i, expect: /help|weather|stock|question|time/i, short: true },
];
async function voicePreview() {
  const studio = page.locator(".ex-config .voice-studio");
  await page.locator(".ex-config summary").click();
  const selects = studio.locator("select").filter({ has: page.locator('option[value]') });
  const voice = selects.last();
  const voices = await voice.locator("option").evaluateAll((options) => options.map((o) => o.value).filter(Boolean));
  assert(voices.length >= 2, "voice catalog must offer multiple voices");
  for (const id of (voices.filter((v) => /\.(Aria|Diego)$/.test(v)).length >= 2 ? voices.filter((v) => /\.(Aria|Diego)$/.test(v)) : voices).slice(0, 2)) {
    await voice.selectOption(id);
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
  const response = await H.turn(page, turn.text, `${rep.key}-${index}`, {
    micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor,
    settle: true, inputWav,
  });
  rep.turns.push(response);
  assert(response.botSpoke, `turn ${index} has no audible response`);
  assert(turn.heard.test(response.domUser), `turn ${index} ASR: ${response.domUser}`);
  assert(turn.expect.test(response.domBot || response.botAsr), `turn ${index} answer: ${response.domBot}`);
  assert(!/\*\*|__|`|asterisk|backtick|full stop|exclamation mark/i.test(response.domBot + response.botAsr), "formatting leaked into speech");
  if (turn.short) assert(response.domBot.split(/\s+/).length <= 40, "default answer exceeds the spoken word budget");
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
  await page.getByRole("button", { name: "Back to conversation" }).click();
  await H.selectExample(page, { consent: true });
  await voicePreview();
  const generic = { key: "generic", turns: [] }; result.conversations.push(generic);
  assert((await H.startConversation(page)).connected);
  assert.deepEqual(result.sessionConfigs.at(-1), { pipeline: "generic-frontend-backend-agent",
    timezone: "Asia/Calcutta", frontendEdited: true, backendEdited: true, persistent: true, sampleBytes: 0 });
  assert(await H.waitForSettledWelcome(page));
  assert(await page.getByRole("button", { name: "Prompts", exact: true }).isDisabled());
  for (let index = 0; index < turns.length; index++) await runTurn(generic, turns[index], index + 1);
  // A real 0.65-second pause inside an unfinished request must not produce two user turns.
  const first = `${H.OUT}/pause-first.wav`, last = `${H.OUT}/pause-last.wav`, joined = `${H.OUT}/pause-user.wav`;
  await synthSpeech("Could you check the weather", first); await synthSpeech("in Tokyo right now?", last);
  await exec("ffmpeg", ["-y", "-i", first, "-i", last, "-filter_complex",
    "[0:a]apad=pad_dur=0.65[a];[a][1:a]concat=n=2:v=0:a=1[out]", "-map", "[out]", joined]);
  await runTurn(generic, { text: "Could you check the weather [pause] in Tokyo right now?", heard: /weather.*tokyo/i,
    expect: /tokyo|degree|celsius/i }, 8, joined);
  assert.equal(generic.turns.at(-1).domUserMessages.length, 1, "mid-sentence pause split the user turn");
  await finish(generic);
  await page.getByRole("button", { name: "Prompts", exact: true }).click();
  await page.getByRole("button", { name: "Restore frontend default", exact: true }).click();
  await page.getByRole("button", { name: "Restore backend default", exact: true }).click();
  assert.equal(await editor.nth(2).inputValue(), "Use calm, friendly language for this demo.");
  await page.getByRole("button", { name: "Back to conversation" }).click();
  await H.selectExample(page, { example: "omni", model: null, consent: true });
  const omni = { key: "omni", turns: [] }; result.conversations.push(omni);
  assert((await H.startConversation(page)).connected); assert(await H.waitForSettledWelcome(page));
  await runTurn(omni, { text: "Show me your architecture.", heard: /architecture/i, expect: /architecture|diagram|design/i,
    architecture: "omni" }, 1);
  await finish(omni);
  if (process.env.SQA_VOICE_SAMPLE) {
    await H.selectExample(page, { consent: true, tts: "zeroshot" });
    await page.locator(".ex-config summary").click();
    const studio = page.locator(".ex-config .voice-studio");
    await studio.locator('input[type="file"]').setInputFiles(process.env.SQA_VOICE_SAMPLE);
    await studio.getByLabel("Use sample for zero-shot voice").check();
    assert(await studio.locator("select").last().isDisabled());
    const clone = { key: "clone", turns: [] }; result.conversations.push(clone);
    assert((await H.startConversation(page)).connected);
    const config = result.sessionConfigs.at(-1);
    assert(!config.frontendEdited && !config.backendEdited && config.persistent && config.sampleBytes > 1000,
      "restored defaults must preserve persistent instructions and the enabled voice sample");
    assert(await H.waitForSettledWelcome(page));
    await runTurn(clone, { text: "Welcome me to your Halloween party in one sentence.", heard: /halloween|party/i,
      expect: /welcome|halloween|party/i }, 1);
    await runTurn(clone, { text: "Please say Nemotron 3 Diarization.", heard: /nemotron|diarization/i,
      expect: /nemotron|diarization/i }, 2);
    await finish(clone);
  }
} catch (error) { result.hardFails.push(error.stack || String(error)); }
finally {
  await H.shot(page, `${H.OUT}/final.png`);
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
