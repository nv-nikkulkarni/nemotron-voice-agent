// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Real-audio regressions reconstructed from two captured NVCF/Astra sessions.
// Raw WAV/JSON evidence stays under the ignored artifacts directory; only this
// durable test definition and the source session IDs are committed.
import fs from "node:fs";
import * as H from "/sqa/lib/harness.mjs";

const OUT = process.env.SQA_OUT || "/sqa/artifacts/captured-session-regressions";
const PRIVATE_NARRATION = /(?:<\s*(?:think|analysis)\b|chain[- ]of[- ]thought|\bthe user(?:'s)? (?:message|request|query|utterance)\b|\bi need to (?:ask for clarification|delegate|decide|call|route|determine)\b)/i;
const SERIALIZED_INTERNAL_CALL = /(?:call_backend|cancel_backend)\s*\(|<\s*(?:tool_call|function|parameter)\b/i;
const LATEST_2022_CLAIM = /(?:\b(?:latest|most recent)\b[^.?!]{0,120}\b2022\b|\b2022\b[^.?!]{0,120}\b(?:latest|most recent)\b)/i;
const WEB_TOOL = /(?:web|search)/i;

function safeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function years(value) {
  return [...safeText(value).matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
}

function inputContains(value, patterns) {
  const text = safeText(value);
  return patterns.every((pattern) => pattern.test(text));
}

function contradictsGroundedYears(groundedAnswer, followupAnswer) {
  const grounded = years(groundedAnswer);
  const followup = years(followupAnswer);
  if (!grounded.length || !followup.length) return false;
  const newestGrounded = Math.max(...grounded);
  return followup.some((year) => year < newestGrounded) && !followup.includes(newestGrounded);
}

async function openSession(browser, signals) {
  const { ctx, page } = await H.newPage(browser, signals);
  try {
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await H.sleep(1500);
    await H.selectExample(page, {
      example: "generic",
      model: "lightning",
      tts: "magpie",
      reasoning: false,
      consent: false,
    });
    const connection = await H.startConversation(page, { timeoutMs: 45000 });
    const sessionId = await H.sessionId(page);
    if (!connection.connected) throw new Error("captured-session regression did not connect");
    if (!(await H.waitForSettledWelcome(page))) throw new Error("welcome did not settle before first turn");
    await H.installToolWatch(page);
    if (!(await H.waitListening(page, { timeoutMs: 35000 }))) throw new Error("session did not reach Listening");
    return { ctx, page, connection, sessionId };
  } catch (error) {
    await ctx.close().catch(() => {});
    throw error;
  }
}

async function spokenTurn(page, prompt, evidenceName) {
  const mark = await H.toolWatchMark(page);
  const turn = await H.turn(page, prompt, evidenceName, {
    settle: true,
    // Code-authored filler is progress, not a terminal response. The longer
    // stability window lets the delegated result arrive before the next turn.
    settleStableMs: 12000,
    speechInstructions: "Speak clearly at a natural pace. Pronounce acronyms as they are commonly spoken.",
  });
  const tools = await H.toolWatchSince(page, mark);
  const assistantMessages = turn.newMessages
    .filter((message) => message.role === "bot")
    .map((message) => safeText(message.text))
    .filter(Boolean);
  return {
    prompt,
    heardByApp: safeText(turn.domUser),
    answer: safeText(assistantMessages.join(" ") || turn.domBot || turn.botAsr),
    assistantMessages,
    botAsr: safeText(turn.botAsr),
    botSpoke: turn.botSpoke,
    tools,
    wallMs: turn.wallMs,
    latencyS: turn.latencyS,
    wav: turn.wav,
  };
}

async function runReasoningNarrationRegression(browser, signals) {
  const sourceSessionId = "52f301234e8c";
  let session;
  try {
    session = await openSession(browser, signals);
    const setup = await spokenTurn(session.page, "What all can you do?", "captured_reasoning_01_capabilities");
    const incompleteStock = await spokenTurn(
      session.page,
      "What is the stock price of?",
      "captured_reasoning_02_incomplete_stock",
    );
    const inputGrounded = inputContains(incompleteStock.heardByApp, [/stock/i, /price/i]);
    const asksForSubject = /(?:which|what).{0,50}(?:ticker|company|stock)|(?:ticker|company).{0,50}(?:name|symbol|asking)/i
      .test(incompleteStock.answer);
    const privateNarrationAbsent = !PRIVATE_NARRATION.test(incompleteStock.answer);
    const internalCallAbsent = !SERIALIZED_INTERNAL_CALL.test(incompleteStock.answer);
    return {
      id: "captured_reasoning_narration_52f301234e8c",
      sourceSessionId,
      runtimeSessionId: session.sessionId,
      setup,
      testedTurn: incompleteStock,
      assertions: {
        inputGrounded,
        botSpoke: incompleteStock.botSpoke,
        asksForSubject,
        privateNarrationAbsent,
        internalCallAbsent,
      },
      pass: inputGrounded && incompleteStock.botSpoke && asksForSubject
        && privateNarrationAbsent && internalCallAbsent,
    };
  } finally {
    await H.endConversation(session?.page).catch(() => {});
    await session?.ctx.close().catch(() => {});
  }
}

async function runStaleDynamicAnswerRegression(browser, signals) {
  const sourceSessionId = "499162cb3960";
  let session;
  try {
    session = await openSession(browser, signals);
    const turns = [];
    turns.push(await spokenTurn(session.page, "Who is the winner of the World Cup?", "captured_stale_01_world_cup"));
    turns.push(await spokenTurn(session.page, "FIFA World Cup.", "captured_stale_02_fifa"));
    turns.push(await spokenTurn(session.page, "This is the latest one.", "captured_stale_03_latest"));
    turns.push(await spokenTurn(
      session.page,
      "Okay. Looks like this is not the latest one.",
      "captured_stale_04_challenge",
    ));
    turns.push(await spokenTurn(
      session.page,
      "Can you find it? Looks like this is not the latest one.",
      "captured_stale_05_refresh",
    ));
    turns.push(await spokenTurn(session.page, "Seriously.", "captured_stale_06_verify"));

    const [initial, fifa, latest, challenge, refresh, verify] = turns;
    const fifaAcronymExact = /fifa/i.test(fifa.heardByApp);
    const inputsGrounded = [
      inputContains(initial.heardByApp, [/winner/i, /world cup/i]),
      inputContains(fifa.heardByApp, [/world cup/i]),
      inputContains(latest.heardByApp, [/latest/i]),
      inputContains(challenge.heardByApp, [/not the latest/i]),
      inputContains(refresh.heardByApp, [/find/i, /not the latest/i]),
      inputContains(verify.heardByApp, [/serious/i]),
    ].every(Boolean);
    const latestDelegated = latest.tools.some((tool) => WEB_TOOL.test(tool));
    const challengeDelegated = challenge.tools.some((tool) => WEB_TOOL.test(tool));
    const refreshDelegated = refresh.tools.some((tool) => WEB_TOOL.test(tool));
    const staleClaimsAbsent = [fifa, latest, challenge, refresh, verify]
      .every((turn) => !LATEST_2022_CLAIM.test(turn.answer));
    const groundedResultNotContradicted = !contradictsGroundedYears(refresh.answer, verify.answer);
    const everyTurnSpoke = turns.every((turn) => turn.botSpoke);

    return {
      id: "captured_stale_dynamic_answer_499162cb3960",
      sourceSessionId,
      runtimeSessionId: session.sessionId,
      turns,
      assertions: {
        inputsGrounded,
        fifaAcronymExact,
        everyTurnSpoke,
        latestDelegated,
        challengeDelegated,
        refreshDelegated,
        staleClaimsAbsent,
        groundedResultNotContradicted,
      },
      pass: inputsGrounded && everyTurnSpoke && latestDelegated && challengeDelegated
        && refreshDelegated && staleClaimsAbsent && groundedResultNotContradicted,
    };
  } finally {
    await H.endConversation(session?.page).catch(() => {});
    await session?.ctx.close().catch(() => {});
  }
}

const report = {
  suite: "captured-session-regressions",
  base: H.BASE,
  startedAt: new Date().toISOString(),
  sourceSessions: ["52f301234e8c", "499162cb3960"],
  results: [],
  consoleErrors: [],
  expectedDiagnostics: [],
  badResponses: [],
  wsClosures: [],
};

fs.mkdirSync(OUT, { recursive: true });
const browser = await H.launchBrowser({ headless: false });
try {
  for (const runRegression of [runReasoningNarrationRegression, runStaleDynamicAnswerRegression]) {
    const signals = H.newSignals();
    try {
      const result = await runRegression(browser, signals);
      report.results.push(result);
      console.log(JSON.stringify(result));
    } catch (error) {
      const result = {
        id: runRegression.name,
        pass: false,
        error: String(error),
      };
      report.results.push(result);
      console.log(JSON.stringify(result));
    } finally {
      for (const key of ["consoleErrors", "expectedDiagnostics", "badResponses", "wsClosures"]) {
        report[key].push(...(signals[key] || []));
      }
    }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  report.passed = report.results.filter((result) => result.pass).length;
  report.failed = report.results.filter((result) => !result.pass).length;
  fs.writeFileSync(`${OUT}/captured_session_regressions_report.json`, JSON.stringify(report, null, 2));
  await browser.close().catch(() => {});
}

console.log(JSON.stringify({
  suite: report.suite,
  passed: report.passed,
  failed: report.failed,
  consoleErrors: report.consoleErrors.length,
  wsClosures: report.wsClosures.length,
}));
process.exit(report.failed || report.consoleErrors.length || report.wsClosures.length ? 1 : 0);
