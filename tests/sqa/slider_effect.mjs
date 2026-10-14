// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Does a live LLM-settings slider change the model's output? The default (temperature 0) is
// deterministic, so a repeated question must repeat its reply (control); after the Frontend
// Temperature slider is dragged to its maximum the same question must produce a different reply.
import assert from "node:assert/strict";
import fs from "node:fs";
import * as H from "./lib/harness.mjs";
const result = { runId: H.RUN_ID, replies: [], hardFails: [] };
const signals = H.newSignals();
const slot = await H.createAudioSlot(94);
const browser = await H.launchBrowser({ env: slot.env });
const { page } = await H.newPage(browser, signals);
const opts = { micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor, settle: true };
const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;
try {
  await page.goto(H.BASE);
  await H.selectExample(page, { consent: false });
  await page.getByRole("button", { name: "Prompts", exact: true }).click();
  const editor = page.locator(".prompt-studio textarea");
  await editor.nth(1).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Back to setup" }).click();
  assert((await H.startConversation(page)).connected);
  assert(await H.waitForSettledWelcome(page));
  const sid = await H.sessionId(page);
  const ask = async (label) => {  // returns the reply text
    const r = await H.turn(page, "Tell me about a lighthouse.", label, opts);
    assert(r.botSpoke, `${label}: no audible reply`);
    result.replies.push({ label, words: words(r.domBot), text: r.domBot }); console.log(label, "=>", r.domBot);
    return r.domBot.trim();
  };
  const baseline = await ask("default-1");
  const control = await ask("default-2");
  await page.getByRole("button", { name: "LLM settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "LLM settings", exact: true });
  await dialog.locator(".llm-role").first().waitFor();
  const number = dialog.getByLabel("Frontend · Talker Temperature value", { exact: true });
  const before = Number(await number.inputValue());
  const slider = dialog.locator('input[type="range"]').first();
  await slider.focus(); await page.keyboard.press("End");
  const after = Number(await number.inputValue());
  assert.equal(after, 2, `slider End should reach the maximum (was ${before}, now ${after})`);
  const put = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/llm-settings") && r.request().method() === "PUT");
  await dialog.getByRole("button", { name: "Apply to session", exact: true }).click();
  assert.equal((await put).status(), 200);
  await dialog.getByRole("status").filter({ hasText: "Applied. Future requests" }).waitFor();
  const server = await (await page.request.get(`${H.BASE}/api/sessions/${sid}/llm-settings`)).json();
  assert.equal(server.settings.frontend.temperature, 2);
  await dialog.getByRole("button", { name: "Close LLM settings", exact: true }).click();
  const hot = await ask("temperature-2");
  result.summary = { before, after, controlIdentical: baseline === control, changedAfterSlider: hot !== baseline };
  assert.equal(control, baseline, "control failed: default settings were not deterministic, test inconclusive");
  assert.notEqual(hot, baseline, "temperature 2 produced the same reply as temperature 0");
  await H.endConversation(page); await H.dismissFeedback(page);
} catch (error) { result.hardFails.push(error.stack || String(error)); }
finally {
  if (result.hardFails.length && await page.locator(".clean-end").count()) await H.endConversation(page).catch(() => {});
  await browser.close();
  result.pass = result.hardFails.length === 0;
  fs.writeFileSync(`${H.OUT}/slider-effect-report.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ pass: result.pass, summary: result.summary, hardFails: result.hardFails }));
  process.exitCode = result.pass ? 0 : 1;
}
