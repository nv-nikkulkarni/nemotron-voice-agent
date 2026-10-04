// SPDX-License-Identifier: BSD-2-Clause
// Exercise the pre-session workflow against real catalogs, synthesis and sessions.
import assert from "node:assert/strict";
import fs from "node:fs";
import * as H from "./lib/harness.mjs";
import { detectAudibleWav } from "./lib/acoustics.mjs";

const result = { runId: H.RUN_ID, previews: [], sessionConfigs: [], hardFails: [] };
const signals = H.newSignals();
const slot = await H.createAudioSlot(92);
const browser = await H.launchBrowser({ env: slot.env });
const { page } = await H.newPage(browser, signals, { timezoneId: "Asia/Kolkata" });
const frontendPrompt = "You are a friendly voice assistant. Keep spoken answers brief.";
const persistentPrompt = "Use calm, friendly language for this demo.";
page.on("request", (request) => {
  if (!request.url().endsWith("/api/session-config") || request.method() !== "POST") return;
  const config = request.postDataJSON();
  result.sessionConfigs.push({ pipeline: config.pipeline_mode, voiceId: config.tts_voice_id,
    frontendEdited: config.prompt_content === frontendPrompt,
    backendEdited: String(config.thinker_prompt_content ?? "").endsWith("Keep tool plans valid JSON."),
    persistent: config.persistent_prompt === persistentPrompt,
    sampleBytes: config.tts_voice_sample?.length ?? 0 });
});

async function audioSettings() {
  await page.getByRole("button", { name: "Audio settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  assert.equal(await settings.getByRole("combobox").count(), 2);
  assert.equal(await settings.getByRole("checkbox").count(), 0);
  assert.equal(await settings.getByRole("radio").count(), 0);
  assert.equal(await settings.locator("textarea, .voice-studio").count(), 0);
  assert(await settings.getByLabel("Input device (microphone)").isEnabled());
  assert(await settings.getByLabel("Output device (speaker)").isEnabled());
  await H.shot(page, `${H.OUT}/audio-settings.png`);
  await settings.getByRole("button", { name: "Close settings" }).click();
}
async function previewVoice(name) {
  const studio = page.locator(".voice-studio");
  const pending = page.waitForResponse((response) => response.url().endsWith("/api/tts/preview") && response.request().method() === "POST");
  await studio.getByRole("button", { name: "Preview voice", exact: true }).click();
  const response = await pending;
  assert.equal(response.status(), 200);
  const player = studio.locator("audio");
  await player.waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".voice-studio audio")?.paused);
  const encoded = await player.evaluate(async (element) => {
    const bytes = new Uint8Array(await (await fetch(element.src)).arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  });
  const path = `${H.OUT}/preview-${name}.wav`;
  fs.writeFileSync(path, Buffer.from(encoded, "base64"));
  const acoustics = await detectAudibleWav(path);
  assert(acoustics.audible, `Preview ${name} must contain audible speech`);
  const config = response.request().postDataJSON();
  result.previews.push({ name, voiceId: config.tts_voice_id, sampleBytes: config.tts_voice_sample?.length ?? 0, pronunciations: config.tts_pronunciations ?? {},
    bytes: fs.statSync(path).size, ...acoustics });
  await player.evaluate((element) => element.pause());
  console.log("Audible preview", name, JSON.stringify(result.previews.at(-1)));
}

try {
  await page.goto(H.BASE);
  assert(await H.waitForDeploymentReady(page));
  const launch = page.getByRole("region", { name: "Selected example actions" });
  await launch.getByRole("button", { name: "Start conversation", exact: true }).waitFor({ timeout: 30000 });
  for (const name of ["Prompts", "Tools", "Voice", "Start conversation"]) {
    assert(await launch.getByRole("button", { name, exact: true }).isVisible());
  }
  assert.equal(await page.locator(".clean-topbar").getByRole("button", { name: "Prompts", exact: true }).count(), 0);
  await H.shot(page, `${H.OUT}/launch-desktop.png`);
  assert.equal(await page.locator("[data-tour=settings], [data-tour=pipeline]").count(), 0);
  await launch.getByRole("button", { name: "Prompts", exact: true }).click();
  assert(new URL(page.url()).pathname === "/prompts");
  const editors = page.locator(".prompt-studio textarea");
  await page.locator(".prompt-studio label").filter({ hasText: "Backend system prompt · planning and tools" }).locator("textarea").waitFor({ timeout: 30000 });
  const backend = await editors.nth(1).inputValue();
  await editors.nth(0).fill(frontendPrompt);
  await editors.nth(1).fill(backend + "\nKeep tool plans valid JSON.");
  await editors.nth(2).fill(persistentPrompt);
  await page.reload();
  await page.locator(".prompt-studio label").filter({ hasText: "Backend system prompt · planning and tools" }).locator("textarea").waitFor({ timeout: 30000 });
  assert.equal(await editors.nth(0).inputValue(), frontendPrompt);
  assert((await editors.nth(1).inputValue()).endsWith("Keep tool plans valid JSON."));
  assert.equal(await editors.nth(2).inputValue(), persistentPrompt);
  assert.equal(await page.locator("[data-tour=settings], [data-tour=pipeline]").count(), 0);
  assert(new URL(page.url()).pathname === "/prompts");
  assert.equal(await editors.nth(0).inputValue(), frontendPrompt);
  await H.shot(page, `${H.OUT}/prompts.png`);
  await page.getByRole("button", { name: "Back to setup" }).click();
  await H.selectExample(page, { consent: true, tts: "magpie" });
  await page.getByRole("button",{name:"Voice",exact:true}).click();
  const studio = page.locator(".voice-studio");
  const cards = studio.locator('input[name="tts-voice"]');
  await cards.first().waitFor();
  assert((await cards.count()) >= 2);
  assert.equal(await studio.locator("select, details").count(), 0);
  assert(await page.getByRole("heading", { name: "Speaking voice", exact: true }).isVisible());
  assert(await page.getByRole("heading", { name: "Create a character voice" }).isVisible());
  const search = studio.getByRole("searchbox", { name: /find a voice/i });
  await search.fill("Diego");
  assert((await cards.count()) > 0);
  assert((await cards.evaluateAll((inputs) => inputs.map((input) => input.value))).every((id) => id.includes("Diego")));
  await search.fill("no matching voice");
  assert.equal(await cards.count(), 0);
  assert(await studio.getByRole("status").isVisible());
  await search.fill("");
  await H.shot(page, `${H.OUT}/voices-desktop.png`);
  // Native radio navigation must update app state, not just its painted card.
  await cards.first().check();
  await cards.first().focus();
  await cards.first().press("ArrowRight");
  assert(await cards.nth(1).isChecked());
  const secondId = await cards.nth(1).inputValue();
  await previewVoice("keyboard-choice");
  assert.equal(result.previews.at(-1).voiceId, secondId);
  const aria = studio.locator('input[name="tts-voice"][value="Magpie-Multilingual.EN-US.Aria"]');
  await aria.check();
  await previewVoice("aria");
  assert.equal(result.previews.at(-1).voiceId, await aria.inputValue());

  await page.getByLabel("Word",{exact:true}).fill("Spookotron");
  await page.getByLabel("IPA pronunciation",{exact:true}).fill("ˈspukətɹɑn");
  await page.getByRole("button",{name:"Save pronunciation",exact:true}).click();
  await previewVoice("ipa-fix");
  assert.equal(result.previews.at(-1).pronunciations.Spookotron,"ˈspukətɹɑn");

  // Phone layout keeps setup actions together and fits the voice cards.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".agent-studio").evaluate((panel) => { panel.scrollTop = 0; });
  await H.shot(page, `${H.OUT}/voices-mobile.png`);
  assert(await page.locator(".agent-studio").evaluate((panel) => panel.scrollWidth <= panel.clientWidth));
  await page.getByRole("button", { name: "Back to setup", exact: true }).click();
  await H.shot(page, `${H.OUT}/launch-mobile.png`);
  const configure = await launch.getByRole("button", { name: "Voice", exact: true }).boundingBox();
  const prompts = await launch.getByRole("button", { name: "Prompts", exact: true }).boundingBox();
  assert(configure && prompts && Math.abs(configure.y - prompts.y) < 2);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await launch.getByRole("button", { name: "Voice", exact: true }).click();
  await page.getByRole("button", { name: "Back to setup" }).click();
  await page.getByRole("button", { name: "Prompts", exact: true }).click();
  assert.equal(await editors.nth(0).inputValue(), frontendPrompt);
  await page.getByRole("button", { name: "Back to setup" }).click();
  await page.setViewportSize({ width: 1280, height: 800 });

  if (process.env.SQA_VOICE_SAMPLE) {
    await H.selectExample(page, { consent: true, tts: "zeroshot" });
    await page.getByRole("button",{name:"Voice",exact:true}).click();
    await studio.locator('input[type="file"]').setInputFiles(process.env.SQA_VOICE_SAMPLE);
    const useSample = studio.getByLabel("Use sample for zero-shot voice");
    await useSample.waitFor();
    await useSample.check();
    for (const voice of await cards.all()) assert(await voice.isDisabled());
    await previewVoice("custom-sample");
    assert(result.previews.at(-1).sampleBytes > 1000);
    await page.reload();
    await H.selectExample(page, { consent: true, tts: "zeroshot" });
    await page.getByRole("button",{name:"Voice",exact:true}).click();
    await studio.getByLabel("Use sample for zero-shot voice").waitFor();
    assert(!(await studio.getByLabel("Use sample for zero-shot voice").isChecked()), "Using a saved sample requires opting in after reload");
    await studio.getByLabel("Use sample for zero-shot voice").check();
    await H.shot(page, `${H.OUT}/custom-voice.png`);
    await studio.getByLabel("Use sample for zero-shot voice").uncheck();
    await studio.getByRole("button", { name: "Remove sample" }).click();
    await studio.getByLabel("Use sample for zero-shot voice").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Back to setup", exact: true }).click();
  }

  await H.selectExample(page, { consent: true, tts: "magpie" });
  await page.getByRole("button",{name:"Voice",exact:true}).click();
  await aria.check();
  await page.getByRole("button", { name: "Back to setup", exact: true }).click();
  await launch.getByRole("button", { name: "Voice", exact: true }).click();
  await page.getByRole("button", {name: "Back to setup", exact:true}).click();
  // Escape cancels the capture dialog and returns focus before any connection.
  await launch.getByRole("button", {name:"Start conversation",exact:true}).click();
  const consentDialog=page.getByRole("dialog",{name:"Help improve the conversation?",exact:true});
  await consentDialog.waitFor();
  const beforeStart=result.sessionConfigs.length;
  await page.keyboard.press("Escape");
  await consentDialog.waitFor({state:"detached"});
  assert.equal(result.sessionConfigs.length,beforeStart);
  assert(await page.locator('[data-tour="start"]').evaluate(element=>element===document.activeElement));
  assert((await H.startConversation(page)).connected);
  assert.deepEqual(result.sessionConfigs.at(-1), { pipeline: "generic-frontend-backend-agent",
    voiceId: "Magpie-Multilingual.EN-US.Aria", frontendEdited: true, backendEdited: true,
    persistent: true, sampleBytes: 0 });
  await page.locator(".conversation-hints").waitFor({state:"hidden",timeout:4000});
  assert(await H.waitForSettledWelcome(page));
  assert.equal(await page.getByRole("button", { name: "Prompts", exact: true }).count(), 0);
  await audioSettings();
  result.turn = await H.turn(page, "Please say hello in one sentence.", "configuration-turn", {
    micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor, settle: true,
  });
  result.turn.acoustics = await detectAudibleWav(result.turn.wav);
  assert(result.turn.botSpoke && result.turn.acoustics.audible, "Configured assistant must answer audibly");
  assert(/hello|hi|hey/i.test(result.turn.domBot || result.turn.botAsr));
  result.sessionId = await H.sessionId(page);
  await H.endConversation(page);
  result.teardown = await page.evaluate(() => window.__session);
  assert(result.teardown?.lastTeardown?.captureFlushed, "Capture must be acknowledged");
  await H.dismissFeedback(page);
  // Switching examples must preserve the launch controls and offer that engine's voices.
  await H.selectExample(page, { example: "omni", model: null, tts: "magpie" });
  await page.getByRole("button",{name:"Voice",exact:true}).click();
  await cards.first().waitFor();
  assert.equal(await page.locator(".ex-config__tools").count(), 0);
  await H.shot(page, `${H.OUT}/omni-configuration.png`);
  await page.getByRole("button", { name: "Back to setup", exact: true }).click();
  result.layout = { desktop: true, mobile: true, keyboard: true, deviceOnlySettings: true, promptPersistence: true };
} catch (error) {
  result.hardFails.push(error.stack || String(error));
} finally {
  await H.shot(page, `${H.OUT}/final.png`);
  if (await page.locator(".clean-end").count()) {
    result.sessionId ||= await H.sessionId(page);
    await H.endConversation(page);
  }
  await browser.close();
  result.signals = signals;
  for (const key of ["consoleErrors", "badResponses", "wsClosures"]) {
    if (signals[key].length) result.hardFails.push(`${key}: ${signals[key].join("; ")}`);
  }
  result.pass = result.hardFails.length === 0;
  fs.writeFileSync(`${H.OUT}/pre-session-configuration-report.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ pass: result.pass, hardFails: result.hardFails }));
  process.exitCode = result.pass ? 0 : 1;
}
