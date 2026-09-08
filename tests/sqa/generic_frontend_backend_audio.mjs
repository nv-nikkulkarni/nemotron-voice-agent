// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Barrier-controlled, real-audio qualification for the Generic Frontend/Backend agent.
// Every browser owns an isolated PulseAudio mic/speaker pair. Unlike Chromium's
// always-on fake-file input, the WAV is played only after every welcome greeting
// has finished and every session reports Listening.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as H from "./lib/harness.mjs";

const execFileP = promisify(execFile);
const N = Math.max(1, Number(process.env.N || 1));
const AUDIO = process.env.AUDIO || "/audio/g_stock_nvda_48k.wav";
const TTS = process.env.TTS || "magpie";
const EXPECT_TOOL = process.env.EXPECT_TOOL || "get_stock_price";
const EXPECT_RESULT = new RegExp(process.env.EXPECT_RESULT || "NVDA|NVIDIA|dollar|[0-9]", "i");
const TIMEOUT_MS = Number(process.env.WAIT_MS || 45000);

async function prepare(i) {
  const slot = await H.createAudioSlot(i + 20);
  const signals = H.newSignals();
  const browser = await H.launchBrowser({ headless: false, env: slot.env });
  const { ctx, page } = await H.newPage(browser, signals, { viewport: { width: 900, height: 700 } });
  try {
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await H.selectExample(page, { example: "generic", tts: TTS, consent: true });
    const connection = await H.startConversation(page, { timeoutMs: 45000 });
    if (!connection.connected) throw new Error("never connected");
    await H.installToolWatch(page);
    if (!(await H.waitListening(page, { timeoutMs: 30000 }))) throw new Error("welcome never reached Listening");
    return { i, slot, signals, browser, ctx, page, connection, sid: await H.sessionId(page) };
  } catch (error) {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
}

async function exercise(session) {
  const { page, slot } = session;
  const beforeMessages = (await H.readMessages(page)).length;
  const toolMark = await H.toolWatchMark(page);
  await execFileP("paplay", [`--device=${slot.micSink}`, AUDIO]);
  const deadline = Date.now() + TIMEOUT_MS;
  let messages = [];
  let tools = [];
  let answer = "";
  while (Date.now() < deadline) {
    messages = await H.readMessages(page);
    tools = await H.toolWatchSince(page, toolMark);
    const current = messages.slice(beforeMessages);
    answer = [...current].reverse().find((message) => message.role === "bot")?.text || "";
    if (tools.some((tool) => tool.toLowerCase().includes(EXPECT_TOOL.toLowerCase())) && EXPECT_RESULT.test(answer)) break;
    await H.sleep(500);
  }
  const user = messages.slice(beforeMessages).find((message) => message.role === "user")?.text || "";
  const toolOk = tools.some((tool) => tool.toLowerCase().includes(EXPECT_TOOL.toLowerCase()));
  const resultOk = EXPECT_RESULT.test(answer);
  const latency = await H.latencyText(page);
  const latencyButton = page.locator(".conv-latency__btn").first();
  const breakdownAvailable = await latencyButton.isEnabled().catch(() => false);
  let breakdownText = "";
  if (breakdownAvailable) {
    await latencyButton.click();
    breakdownText = await page.locator('[role="dialog"][aria-label="Latency breakdown"]').innerText().catch(() => "");
  }
  const ended = await H.endConversation(page);
  return {
    i: session.i,
    sid: session.sid,
    connected: session.connection.connected,
    connectMs: session.connection.connectMs,
    user,
    answer,
    tools,
    toolOk,
    resultOk,
    latency,
    breakdownAvailable,
    breakdownText,
    ended,
    consoleErrors: session.signals.consoleErrors,
    badResponses: session.signals.badResponses,
    ok: Boolean(user) && toolOk && resultOk && breakdownAvailable && /latency breakdown/i.test(breakdownText) && session.signals.consoleErrors.length === 0,
  };
}

const sessions = [];
let results = [];
try {
  console.log(`Preparing ${N} isolated ${TTS} sessions against ${H.BASE}`);
  sessions.push(...(await Promise.all(Array.from({ length: N }, (_, index) => prepare(index)))));
  console.log("All sessions are Listening; playing real audio concurrently");
  results = await Promise.all(sessions.map(exercise));
  for (const result of results) console.log(JSON.stringify(result));
} catch (error) {
  console.error(String(error));
} finally {
  await Promise.all(sessions.map(async ({ ctx, browser }) => {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }));
}

const passed = results.filter((result) => result.ok).length;
console.log(`${passed}/${N} controlled-audio sessions passed`);
process.exit(passed === N ? 0 : 1);
