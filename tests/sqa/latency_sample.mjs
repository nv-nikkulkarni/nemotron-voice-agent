// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// One real spoken turn against the NVCF voice agent endpoint, reporting the
// server's own stage breakdown plus the client-observed time to first audio.
import fs from "node:fs";
import * as H from "./lib/harness.mjs";
const result = { base: H.BASE, checks: {} };
const signals = H.newSignals();
const slot = await H.createAudioSlot(96);
const browser = await H.launchBrowser({ env: slot.env });
const { page } = await H.newPage(browser, signals);
page.on("console", () => {});
await page.goto(H.BASE, { waitUntil: "domcontentloaded" });
await H.selectExample(page, { consent: false });
const connected = (await H.startConversation(page)).connected;
result.checks.connected = connected;
await H.waitForSettledWelcome(page);
const turn = await H.turn(page, "What is the weather in Tokyo right now?", "latency-sample", {
  micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor, settle: true,
});
result.turn = { domUser: turn.domUser, domBot: turn.domBot, botSpoke: turn.botSpoke, responseMs: turn.responseMs, onsetSource: turn.onsetSource, acousticMaxVolumeDb: turn.acoustics?.maxVolumeDb };
result.checks.clientFirstAudioLatencyLabel = await page.locator(".conv-latency__label").innerText().catch(() => "n/a");
result.checks.clientFirstAudioLatencyValue = await page.locator(".conv-latency__value").innerText().catch(() => "n/a");
const canExpand = await page.locator(".conv-latency__btn").isEnabled().catch(() => false);
result.checks.serverBreakdownAvailable = canExpand;
if (canExpand) {
  await page.locator(".conv-latency__btn").click();
  await page.locator(".lat-breakdown").waitFor({ timeout: 5000 }).catch(() => {});
  result.checks.serverBreakdownText = await page.locator(".lat-breakdown").innerText().catch(() => "n/a");
}
await H.shot(page, `${H.OUT}/latency-sample.png`);
await H.endConversation(page);
fs.writeFileSync(`${H.OUT}/latency-sample-report.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
