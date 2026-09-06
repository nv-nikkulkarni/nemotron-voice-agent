// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Browser-side evidence for the production-remediation capture matrix. NGC
// UPLOAD_COMPLETE correlation is performed separately with the session IDs in
// this report because the public status endpoint intentionally omits versions.
import fs from "node:fs";
import * as H from "./lib/harness.mjs";

const OUT = process.env.SQA_OUT || "/sqa/out";
const WS_CAPTURE = `window.__sockets = [];
(function(){ const OW = window.WebSocket;
  function W(...a){ const s = new OW(...a); try{window.__sockets.push(s);}catch(e){} return s; }
  W.prototype = OW.prototype; Object.assign(W, OW); window.WebSocket = W; })();`;

function captureObserver(page) {
  const observed = { requests: [], responses: [] };
  page.on("request", (request) => {
    if (!request.url().includes("/api/session-capture")) return;
    let body = {};
    try { body = JSON.parse(request.postData() || "{}"); } catch { /* retain empty body */ }
    observed.requests.push({
      method: request.method(),
      sessionId: String(body.session_id || ""),
      consent: body.consent === true,
    });
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/session-capture")) {
      observed.responses.push({ status: response.status(), ok: response.ok() });
    }
  });
  return observed;
}

async function waitForCapture(observer, maxMs = 7000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (observer.responses.some((response) => response.ok)) return true;
    await H.sleep(100);
  }
  return observer.responses.some((response) => response.ok);
}

async function openSession(browser, { consent, socketCapture = false }) {
  const sig = H.newSignals();
  const { ctx, page } = await H.newPage(browser, sig);
  if (socketCapture) await ctx.addInitScript(WS_CAPTURE);
  const capture = captureObserver(page);
  await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await H.sleep(750);
  await H.selectExample(page, {
    example: "generic",
    model: "lightning",
    tts: "magpie",
    consent,
  });
  const connection = await H.startConversation(page, { timeoutMs: 60000 });
  const sessionId = await H.sessionId(page);
  if (connection.connected) await H.sleep(3500);
  return { sig, ctx, page, capture, connected: connection.connected, sessionId };
}

async function normalSession(browser, index, consent) {
  const run = await openSession(browser, { consent });
  await H.endConversation(run.page);
  const acknowledged = await waitForCapture(run.capture);
  const result = {
    index,
    consent,
    sessionId: run.sessionId,
    connected: run.connected,
    acknowledged,
    requests: run.capture.requests,
    responses: run.capture.responses,
    consoleErrors: run.sig.consoleErrors,
    wsClosures: run.sig.wsClosures,
  };
  result.pass = result.connected
    && result.sessionId.length > 0
    && result.acknowledged
    && result.requests.some(
      (request) => request.sessionId === result.sessionId && request.consent === consent,
    )
    && result.consoleErrors.length === 0
    && result.wsClosures.length === 0;
  await run.ctx.close().catch(() => {});
  return result;
}

async function immediateClose(browser) {
  const run = await openSession(browser, { consent: true });
  await run.page.goto("about:blank", { waitUntil: "commit", timeout: 10000 });
  await H.sleep(2000);
  const result = {
    case: "immediate-browser-close",
    sessionId: run.sessionId,
    connected: run.connected,
    requestObserved: run.capture.requests.some(
      (request) => request.sessionId === run.sessionId && request.consent,
    ),
    acknowledged: run.capture.responses.some((response) => response.ok),
    requests: run.capture.requests,
    responses: run.capture.responses,
  };
  await run.ctx.close().catch(() => {});
  return result;
}

async function forcedDrop(browser) {
  const run = await openSession(browser, { consent: true, socketCapture: true });
  H.expectForcedWebSocketClose(run.sig, true);
  const socketsCaptured = await run.page.evaluate(() => window.__sockets.length);
  await run.page.evaluate(() => {
    window.__sockets.forEach((socket) => {
      try { socket.close(4001, "sqa-capture-forced-drop"); } catch { /* ignore */ }
    });
  });
  await run.page.locator('.demo-modal-backdrop[aria-label="Session interrupted"]').waitFor({
    state: "visible",
    timeout: 20000,
  }).catch(() => {});
  const acknowledged = await waitForCapture(run.capture, 10000);
  H.expectForcedWebSocketClose(run.sig, false);
  const result = {
    case: "forced-websocket-drop",
    sessionId: run.sessionId,
    connected: run.connected,
    socketsCaptured,
    acknowledged,
    requests: run.capture.requests,
    responses: run.capture.responses,
    expectedDiagnostics: run.sig.expectedDiagnostics,
    unexpectedConsoleErrors: run.sig.consoleErrors,
    unexpectedWebSocketErrors: run.sig.wsClosures,
  };
  result.pass = result.connected
    && result.socketsCaptured > 0
    && result.acknowledged
    && result.unexpectedConsoleErrors.length === 0
    && result.unexpectedWebSocketErrors.length === 0;
  await run.ctx.close().catch(() => {});
  return result;
}

async function longSession(browser) {
  const run = await openSession(browser, { consent: true });
  const prompts = [
    "Introduce yourself in one short sentence.",
    "What is two plus two?",
    "Name one primary color.",
    "What is the capital of France?",
    "Give one short focus tip.",
    "What is ten divided by two?",
    "Say one encouraging sentence.",
    "Thank you and goodbye.",
  ];
  const turns = [];
  for (let index = 0; index < prompts.length; index += 1) {
    const turn = await H.turn(run.page, prompts[index], `capture_long_${index + 1}`, {
      transcribeBot: false,
      settle: true,
      settleStableMs: 5000,
    });
    turns.push({ prompt: prompts[index], botAudio: turn.botSpoke, answer: turn.domBot });
  }
  await H.endConversation(run.page);
  const acknowledged = await waitForCapture(run.capture);
  const result = {
    case: "long-session",
    sessionId: run.sessionId,
    connected: run.connected,
    acknowledged,
    turns,
    requests: run.capture.requests,
    responses: run.capture.responses,
    consoleErrors: run.sig.consoleErrors,
    wsClosures: run.sig.wsClosures,
  };
  result.pass = result.connected
    && result.acknowledged
    && result.turns.every((turn) => turn.botAudio)
    && result.consoleErrors.length === 0
    && result.wsClosures.length === 0;
  await run.ctx.close().catch(() => {});
  return result;
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await H.launchBrowser({ headless: false });
const report = {
  at: new Date().toISOString(),
  base: H.BASE,
  consented: [],
  declined: [],
  edgeCases: [],
};
try {
  report.consented = await Promise.all(
    Array.from({ length: 20 }, (_, index) => normalSession(browser, index + 1, true)),
  );
  report.declined = await Promise.all(
    Array.from({ length: 5 }, (_, index) => normalSession(browser, index + 1, false)),
  );
  report.edgeCases.push(await longSession(browser));
  report.edgeCases.push(await immediateClose(browser));
  report.edgeCases.push(await forcedDrop(browser));
} finally {
  await browser.close().catch(() => {});
}
const sessionIds = [
  ...report.consented.map((session) => session.sessionId),
  ...report.declined.map((session) => session.sessionId),
  ...report.edgeCases.map((session) => session.sessionId),
].filter(Boolean);
report.uniqueSessionIds = new Set(sessionIds).size;
report.browserPass = report.consented.every((session) => session.pass)
  && report.declined.every((session) => session.pass)
  && report.edgeCases.filter((edge) => edge.case !== "immediate-browser-close").every((edge) => edge.pass)
  && report.edgeCases.find((edge) => edge.case === "immediate-browser-close")?.requestObserved === true
  && report.uniqueSessionIds === sessionIds.length;
fs.writeFileSync(`${OUT}/capture_lifecycle_matrix_report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  browserPass: report.browserPass,
  consentedPassed: report.consented.filter((session) => session.pass).length,
  declinedPassed: report.declined.filter((session) => session.pass).length,
  edgeCases: report.edgeCases.map((edge) => ({
    case: edge.case,
    pass: edge.pass,
    requestObserved: edge.requestObserved,
    sessionId: edge.sessionId,
  })),
  uniqueSessionIds: report.uniqueSessionIds,
}));
process.exitCode = report.browserPass ? 0 : 1;
