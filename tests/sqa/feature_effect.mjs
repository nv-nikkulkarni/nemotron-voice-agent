// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Do the pre-session and live controls change behavior, not just reach the server?
//   1. Prompt effect: an edited persona must show up in a real spoken reply.
//   2. LLM sliders: drag a slider, apply it live, read the value back from the server.
//   3. Zero-shot reference voice: a synthesized sample is sent and the bot still speaks.
import assert from "node:assert/strict";
import fs from "node:fs";
import * as H from "./lib/harness.mjs";
import { synthSpeech } from "./lib/audio.mjs";
const result = { runId: H.RUN_ID, checks: [], sessionConfigs: [], hardFails: [] };
const signals = H.newSignals();
const slot = await H.createAudioSlot(93);
const browser = await H.launchBrowser({ env: slot.env });
const { page } = await H.newPage(browser, signals);
page.on("request", (request) => {
  if (!request.url().endsWith("/api/session-config") || request.method() !== "POST") return;
  const c = request.postDataJSON();
  result.sessionConfigs.push({ ttsId: c.tts_id, voiceId: c.tts_voice_id, frontendEdited: Boolean(c.prompt_content), persistent: Boolean(c.persistent_prompt), sampleBytes: c.tts_voice_sample?.length ?? 0 });
});
const pass = (name, detail = {}) => { result.checks.push({ name, pass: true, ...detail }); console.log("PASS", name, JSON.stringify(detail)); };
const opts = { micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor, settle: true };
async function finish() {
  await H.endConversation(page);
  await H.dismissFeedback(page);
}
try {
  await page.goto(H.BASE);

  // 1 + 2: persona effect, then slider effect, in one live session on the default engine.
  await H.selectExample(page, { consent: false });
  await page.getByRole("button", { name: "Prompts", exact: true }).click();
  const editor = page.locator(".prompt-studio textarea");
  await editor.nth(1).waitFor({ state: "visible" });
  await editor.nth(0).fill("You are Captain Barnacle, a pirate. Begin every single reply with the word Arrr, then answer in one short sentence.");
  await editor.nth(2).fill("Never break the pirate persona.");
  await page.getByRole("button", { name: "Back to setup" }).click();
  assert((await H.startConversation(page)).connected);
  assert(await H.waitForSettledWelcome(page));
  const persona = await H.turn(page, "Tell me what you like about the ocean.", "effect-persona", opts);
  assert(persona.botSpoke, "persona turn has no audible reply");
  console.log("persona reply:", persona.domBot);
  assert(/\barr+h?\b/i.test(persona.domBot) || /\barr+h?\b/i.test(persona.botAsr), `edited persona did not change the reply: ${persona.domBot}`);
  pass("prompt-persona-changes-reply", { reply: persona.domBot });

  const sid = await H.sessionId(page);
  await page.getByRole("button", { name: "LLM settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "LLM settings", exact: true });
  await dialog.locator(".llm-role").first().waitFor();
  const slider = dialog.locator('input[type="range"]').first();
  const number = dialog.getByLabel("Frontend · Talker Temperature value", { exact: true });
  const before = Number(await number.inputValue());
  const box = await slider.boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);   // drag target: mid-range
  const dragged = Number(await number.inputValue());
  assert(dragged > 0.8 && dragged < 1.2 && dragged !== before, `slider did not move the value (was ${before}, now ${dragged})`);
  await slider.focus(); await page.keyboard.press("ArrowRight");
  const stepped = Number(await number.inputValue());
  assert(stepped > dragged, "keyboard step did not raise the value");
  const put = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/llm-settings") && r.request().method() === "PUT");
  await dialog.getByRole("button", { name: "Apply to session", exact: true }).click();
  assert.equal((await put).status(), 200);
  await dialog.getByRole("status").filter({ hasText: "Applied. Future requests" }).waitFor();
  const server = await (await page.request.get(`${H.BASE}/api/sessions/${sid}/llm-settings`)).json();
  assert.equal(server.settings.frontend.temperature, stepped, "server value differs from the slider value");
  pass("llm-slider-drag-apply-readback", { before, dragged, stepped, server: server.settings.frontend.temperature });
  await dialog.getByRole("button", { name: "Close LLM settings", exact: true }).click();
  const after = await H.turn(page, "What is your favorite thing about the sea?", "effect-after-apply", opts);
  assert(after.botSpoke, "no audible reply after applying slider settings");
  pass("session-continues-after-slider-apply", { reply: after.domBot });
  await finish();

  // restore prompts so the persona does not leak into later runs
  await page.getByRole("button", { name: "Prompts", exact: true }).click();
  await page.getByRole("button", { name: "Restore frontend default", exact: true }).click();
  await editor.nth(2).fill("");
  await page.getByRole("button", { name: "Back to setup" }).click();

  // 3: zero-shot reference voice
  const sample = `${H.OUT}/reference-voice.wav`;
  await synthSpeech("Welcome to the Nemotron voice agent demo. I am recording a short sample so that you can clone the sound of my voice.", sample);
  await H.selectExample(page, { consent: false, tts: "zeroshot" });
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  const studio = page.locator(".agent-studio .voice-studio");
  await studio.locator('input[type="file"]').setInputFiles(sample);
  await studio.getByLabel("Use sample for zero-shot voice").check();
  await page.getByRole("button", { name: "Back to setup", exact: true }).click();
  assert((await H.startConversation(page)).connected);
  const cfg = result.sessionConfigs.at(-1);
  assert(/zeroshot/i.test(cfg.ttsId) && cfg.sampleBytes > 1000, `reference sample not sent: ${JSON.stringify(cfg)}`);
  assert(await H.waitForSettledWelcome(page));
  const clone = await H.turn(page, "Please say hello in one short sentence.", "effect-clone", opts);
  assert(clone.botSpoke, "zero-shot reference voice produced no audible reply");
  pass("zeroshot-reference-voice-session", { ttsId: cfg.ttsId, sampleBytes: cfg.sampleBytes, reply: clone.domBot, maxVolumeDb: clone.acoustics?.maxVolumeDb });
  await finish();
} catch (error) { result.hardFails.push(error.stack || String(error)); }
finally {
  await H.shot(page, `${H.OUT}/feature-effect-final.png`);
  if (result.hardFails.length && await page.locator(".clean-end").count()) await H.endConversation(page).catch(() => {});
  await browser.close();
  for (const key of ["consoleErrors", "badResponses", "wsClosures"]) if (signals[key].length) result.hardFails.push(`${key}: ${signals[key].join("; ")}`);
  result.pass = result.hardFails.length === 0;
  fs.writeFileSync(`${H.OUT}/feature-effect-report.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ pass: result.pass, hardFails: result.hardFails }));
  process.exitCode = result.pass ? 0 : 1;
}
