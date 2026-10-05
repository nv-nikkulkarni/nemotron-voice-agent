// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// The architecture diagram opens from the conversation button and from a spoken request,
// showing the bundled image that belongs to the selected example.
import assert from "node:assert/strict";
import fs from "node:fs";
import * as H from "./lib/harness.mjs";
const result = { runId: H.RUN_ID, checks: [], hardFails: [] };
const signals = H.newSignals();
const slot = await H.createAudioSlot(95);
const browser = await H.launchBrowser({ env: slot.env });
const { page } = await H.newPage(browser, signals);
const opts = { micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor, settle: true };
async function expectImage(name, file) {
  const image = page.locator(".architecture-presentation img");
  await image.waitFor({ state: "visible", timeout: 20000 });
  assert((await image.getAttribute("src")).endsWith(file), `${name}: wrong image ${await image.getAttribute("src")}`);
  await page.waitForFunction(() => { const img = document.querySelector(".architecture-presentation img"); return img && img.complete && img.naturalWidth > 1000; },
    null, { timeout: 20000 }).catch(() => { throw new Error(`${name}: image did not load`); });
  await H.shot(page, `${H.OUT}/${name}.png`);
  result.checks.push({ name, pass: true }); console.log("PASS", name);
  await page.getByRole("button", { name: "Close image" }).click();
  await image.waitFor({ state: "detached", timeout: 5000 });
}
try {
  await page.goto(H.BASE);
  for (const [example, file] of [["generic", "/architecture-generic.png"], ["omni", "/architecture-omni.png"]]) {
    await H.selectExample(page, { example, model: example === "omni" ? null : "lightning", consent: false });
    assert((await H.startConversation(page)).connected);
    assert(await H.waitForSettledWelcome(page));
    await page.getByRole("button", { name: "Show architecture", exact: true }).click();
    await expectImage(`${example}-button`, file);
    const turn = await H.turn(page, "Show me your architecture.", `${example}-voice`, opts);
    assert(turn.botSpoke, `${example}: no spoken reply`);
    await expectImage(`${example}-voice`, file);
    await H.endConversation(page); await H.dismissFeedback(page);
  }
} catch (error) { result.hardFails.push(error.stack || String(error)); }
finally {
  await H.shot(page, `${H.OUT}/architecture-final.png`);
  if (result.hardFails.length && await page.locator(".clean-end").count()) await H.endConversation(page).catch(() => {});
  await browser.close();
  result.pass = result.hardFails.length === 0;
  fs.writeFileSync(`${H.OUT}/architecture-image-report.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ pass: result.pass, hardFails: result.hardFails }));
  process.exitCode = result.pass ? 0 : 1;
}
