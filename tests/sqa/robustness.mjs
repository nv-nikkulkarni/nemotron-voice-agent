// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Conversation-robustness + "is the session-ended popup abrupt / does it kill the
// conversation?" probes:
//   1. barge-in     — interrupt the bot mid-utterance; does it stop + answer the
//                     new question (conversation survives) or ignore us?
//   2. end-mid-speech — click End while the bot is talking; how fast does audio
//                     cut, and does the "Session ended" modal appear instantly?
//   3. drop         — force an involuntary network drop; does the SAME thank-you
//                     modal appear (mislabeled "user"), and is there any reconnect?
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as H from "./lib/harness.mjs";
import { transcribe } from "./lib/audio.mjs";
const execFileP = promisify(execFile);
const out = { at: new Date().toISOString(), base: H.BASE, tests: [] };
const add = (o) => { out.tests.push(o); console.log("  " + JSON.stringify(o)); };

async function botOnset(page, maxMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { const b = await page.evaluate(() => window.__bot).catch(() => null); if (b?.onsetMs != null) return Date.now() - t0; await H.sleep(120); }
  return null;
}
async function botLevel(page) { const b = await page.evaluate(() => window.__bot).catch(() => null); const r = (b?.rms || []).slice(-4); return Math.max(0, ...r.map(([, v]) => v)); }

// ---------- 1. barge-in / interruption ----------
async function testBargeIn(browser) {
  const sig = H.newSignals(); const { page } = await H.newPage(browser, sig);
  await page.goto(H.BASE, { waitUntil: "domcontentloaded" }); await H.sleep(1400);
  await H.selectExample(page, { example: "generic", model: "lightning" });
  const conn = await H.startConversation(page); await H.sleep(1500);
  if (!conn.connected) return add({ test: "barge-in", pass: false, why: "no connect" });
  // ask for a long answer
  await page.evaluate(() => window.__botReset());
  await H.speak("Please tell me a long detailed story about the history of computing, at least ten sentences.", "bi_q1");
  const onset = await botOnset(page, 14000);
  await H.sleep(1600); // let it get into the story
  const levelBeforeBarge = await botLevel(page);
  // interrupt with a new short question
  const rec = execFile("ffmpeg", ["-y", "-f", "pulse", "-i", "spk_sink.monitor", "-ac", "1", "-ar", "16000", `${H.OUT}/bi_after.wav`]);
  await page.evaluate(() => window.__botReset());
  await H.speak("Wait, stop. What is two plus two?", "bi_q2");
  await H.sleep(6000);
  rec.kill("SIGINT"); await new Promise((r) => rec.on("exit", r));
  const heard = await transcribe(`${H.OUT}/bi_after.wav`).catch(() => "");
  const msgs = await H.readMessages(page);
  const askedNew = msgs.some((m) => m.role === "user" && /two plus two|2 plus 2|stop/i.test(m.text));
  const answered4 = /(\b4\b|four)/i.test(heard) || msgs.slice(-3).some((m) => m.role === "bot" && /\b4\b|four/i.test(m.text));
  await H.endConversation(page); await page.context().close().catch(() => {});
  add({ test: "barge-in", pass: askedNew && answered4, onsetMs: onset, levelBeforeBarge: +levelBeforeBarge.toFixed(3),
    interruptedAndAnswered: answered4, newUserTurnRegistered: askedNew, heardAfter: heard.slice(0, 70),
    consoleErrors: sig.consoleErrors.length });
}

// ---------- 2. End mid-bot-speech (abruptness) ----------
async function testEndMidSpeech(browser) {
  const sig = H.newSignals(); const { page } = await H.newPage(browser, sig);
  await page.goto(H.BASE, { waitUntil: "domcontentloaded" }); await H.sleep(1400);
  await H.selectExample(page, { example: "generic", model: "lightning" });
  const conn = await H.startConversation(page); await H.sleep(1500);
  if (!conn.connected) return add({ test: "end-mid-speech", pass: false, why: "no connect" });
  await page.evaluate(() => window.__botReset());
  await H.speak("Please count slowly from one to twenty, one number per second.", "end_q");
  await botOnset(page, 14000);
  await H.sleep(1200); // bot is mid-count
  const levelBefore = await botLevel(page);
  const tEnd = Date.now();
  await page.locator(".clean-end, button:has-text('End')").first().click();
  // measure how quickly audio goes quiet + modal appears
  let audioCutMs = null, modalMs = null;
  while (Date.now() - tEnd < 4000 && (audioCutMs === null || modalMs === null)) {
    if (audioCutMs === null && (await botLevel(page)) < 0.01) audioCutMs = Date.now() - tEnd;
    if (modalMs === null && (await page.locator(".demo-modal-backdrop").count()) > 0) modalMs = Date.now() - tEnd;
    await H.sleep(50);
  }
  const modalLabel = await page.locator(".demo-modal-backdrop").getAttribute("aria-label").catch(() => "");
  const modalText = await page.locator(".demo-modal h2").innerText().catch(() => "");
  // did it animate in? check computed animation on the backdrop
  const anim = await page.locator(".demo-modal-backdrop").evaluate((el) => getComputedStyle(el).animationName).catch(() => "none");
  await page.context().close().catch(() => {});
  add({ test: "end-mid-speech", pass: modalMs !== null, levelBeforeEnd: +levelBefore.toFixed(3),
    audioCutMs, modalAppearMs: modalMs, modalLabel, modalText, backdropAnimation: anim,
    note: `audio cuts ~immediately on End (intended); modal entrance animation = ${anim}`, consoleErrors: sig.consoleErrors.length });
}

// ---------- 3. involuntary transport drop (force-close the WS) ----------
const WS_CAPTURE = `window.__sockets = [];
(function(){ const OW = window.WebSocket;
  function W(...a){ const s = new OW(...a); try{window.__sockets.push(s);}catch(e){} return s; }
  W.prototype = OW.prototype; Object.assign(W, OW); window.WebSocket = W; })();`;

async function testDrop(browser) {
  const sig = H.newSignals(); const { ctx, page } = await H.newPage(browser, sig);
  await ctx.addInitScript(WS_CAPTURE);
  await page.goto(H.BASE, { waitUntil: "domcontentloaded" }); await H.sleep(1400);
  await H.selectExample(page, { example: "generic", model: "lightning" });
  const conn = await H.startConversation(page); await H.sleep(1500);
  if (!conn.connected) return add({ test: "drop", pass: false, why: "no connect" });
  const idBefore = await H.sessionId(page);
  const nSockets = await page.evaluate(() => window.__sockets.length);
  const tDrop = Date.now();
  // Force-close every open socket -> the transport sees an expected test-induced close.
  H.expectForcedWebSocketClose(sig, true);
  await page.evaluate(() => window.__sockets.forEach((s) => { try { s.close(4001, "sqa-forced-drop"); } catch (e) {} }));
  let modalMs = null;
  for (let i = 0; i < 40; i++) { // up to ~16s
    await H.sleep(400);
    if (modalMs === null && (await page.locator(".demo-modal-backdrop").count()) > 0) modalMs = Date.now() - tDrop;
    if (modalMs !== null) break;
  }
  const modalText = await page.locator(".demo-modal h2").innerText().catch(() => "");
  const modalLabel = await page.locator(".demo-modal-backdrop").getAttribute("aria-label").catch(() => "");
  const reconnectButton = page.getByRole("button", { name: "Reconnect", exact: true });
  const reconnectUiSeen = await reconnectButton.isVisible().catch(() => false);
  let reconnectClicked = false;
  let reconnected = false;
  let idAfter = "";
  if (reconnectUiSeen) {
    await reconnectButton.click();
    reconnectClicked = true;
    for (let i = 0; i < 75; i++) { // up to ~30s
      await H.sleep(400);
      const caption = (await H.orbCaption(page)).toLowerCase();
      idAfter = await H.sessionId(page);
      if (/listening|speaking|thinking|connected|ready/.test(caption) && idAfter && idAfter !== idBefore) {
        reconnected = true;
        break;
      }
    }
  }
  H.expectForcedWebSocketClose(sig, false);
  const pass = nSockets > 0 && modalMs !== null && modalLabel === "Session interrupted" &&
    !/thank you/i.test(modalText) && reconnectUiSeen && reconnectClicked && reconnected &&
    idAfter !== idBefore && sig.consoleErrors.length === 0 && sig.wsClosures.length === 0;
  add({ test: "drop", pass, idBefore, idAfter, socketsCaptured: nSockets, dropToModalMs: modalMs,
    showedThankYouModal: /thank you/i.test(modalText), modalLabel, reconnectUiSeen, reconnectClicked, reconnected,
    uniqueSessionId: Boolean(idAfter && idAfter !== idBefore), expectedForcedCloseDiagnostics: sig.expectedDiagnostics.length,
    unexpectedConsoleErrors: sig.consoleErrors, unexpectedWebSocketErrors: sig.wsClosures,
    finding: "forced WS close must show Session interrupted, expose Reconnect, and establish a new unique session" });
  await page.context().close().catch(() => {});
}

(async () => {
  fs.mkdirSync(H.OUT, { recursive: true });
  console.log(`\n===== ROBUSTNESS vs ${H.BASE} =====`);
  const browser = await H.launchBrowser({ headless: false });
  try { await testBargeIn(browser); await testEndMidSpeech(browser); await testDrop(browser); }
  finally { await browser.close().catch(() => {}); }
  fs.writeFileSync(`${H.OUT}/robustness_report.json`, JSON.stringify(out, null, 2));
  console.log(`  report: out/robustness_report.json\n`);
})();
