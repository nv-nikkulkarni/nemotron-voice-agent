// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Production gate: eight isolated real-audio sessions, ten repeated Lightning
// weather turns per session. Every turn must invoke the expected native tool,
// produce bot audio, remain grounded to its own city, and avoid cross-session
// location leakage. Query and response WAVs are generated under SQA_OUT only.

import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import * as H from "./lib/harness.mjs";
import { synthSpeech, transcribe } from "./lib/audio.mjs";

const execFileP = promisify(execFile);
const N = Number(process.env.N || 8);
const TURNS = Number(process.env.TURNS || 10);
const EXPECT_TOOL = process.env.EXPECT_TOOL || "get_weather";
const TTS = process.env.TTS || "magpie";
const OUT = process.env.SQA_OUT || "/sqa/out";
const INPUT_SYNTH_ATTEMPTS = Number(process.env.INPUT_SYNTH_ATTEMPTS || 3);
const TRANSCRIPTION_ATTEMPTS = Number(process.env.TRANSCRIPTION_ATTEMPTS || 5);
const INPUT_SPEECH_INSTRUCTIONS =
  "Speak the supplied sentence verbatim in a neutral, clear software test voice. "
  + "Pronounce every city name carefully. Do not answer, paraphrase, omit, or add words.";
const INPUT_CITY_ALIASES = new Map([
  ["Bengaluru", ["Bangalore"]],
]);
const CITY_SPOKEN_SUBJECTS = new Map([
  ["Rome", "Rome, spelled R O M E, in Italy"],
  ["Osaka", "Osaka, spelled O S A K A, in Japan"],
  ["Seoul", "Seoul, spelled S E O U L, in South Korea"],
  ["Bengaluru", "Bengaluru, also known as Bangalore, in India"],
  ["Hyderabad", "Hyderabad, spelled H Y D E R A B A D, in India"],
  ["Perth", "Perth, spelled P E R T H, in Australia"],
  ["Lagos", "Lagos, spelled L A G O S, in Nigeria"],
  ["Accra", "Accra, spelled A C C R A, in Ghana"],
  ["Dakar", "Dakar, the capital of Senegal"],
]);
const inputAudioValidation = [];
let transcriptionTail = Promise.resolve();

const CITY_BANKS = [
  ["London", "Paris", "Berlin", "Madrid", "Rome", "Lisbon", "Dublin", "Vienna", "Prague", "Oslo"],
  ["Tokyo", "Osaka", "Seoul", "Busan", "Beijing", "Shanghai", "Taipei", "Bangkok", "Hanoi", "Manila"],
  ["Mumbai", "Delhi", "Bengaluru", "Chennai", "Hyderabad", "Pune", "Jaipur", "Ahmedabad", "Kolkata", "Kochi"],
  ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Winnipeg", "Halifax", "Edmonton", "Quebec City", "Regina"],
  ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Darwin", "Hobart", "Cairns", "Canberra", "Newcastle"],
  ["Cairo", "Nairobi", "Lagos", "Accra", "Dakar", "Kigali", "Kampala", "Lusaka", "Harare", "Windhoek"],
  ["Sao Paulo", "Rio de Janeiro", "Lima", "Santiago", "Bogota", "Quito", "Caracas", "Montevideo", "Asuncion", "La Paz"],
  ["New York", "Boston", "Chicago", "Seattle", "Denver", "Phoenix", "Dallas", "Houston", "Miami", "Atlanta"],
];

if (!Number.isInteger(N) || N < 1 || N > CITY_BANKS.length) {
  throw new Error(`N must be an integer from 1 to ${CITY_BANKS.length}`);
}
if (!Number.isInteger(TURNS) || TURNS < 1 || TURNS > CITY_BANKS[0].length * 2) {
  throw new Error(`TURNS must be an integer from 1 to ${CITY_BANKS[0].length * 2}`);
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsCity = (text, city) => new RegExp(`\\b${escapeRegExp(city)}\\b`, "i").test(text);
const cityMentions = (city) => [city, ...(INPUT_CITY_ALIASES.get(city) || [])];
const containsExpectedCity = (text, city) => cityMentions(city).some((mention) => containsCity(text, mention));

async function transcribeWithRetry(path) {
  const previous = transcriptionTail;
  let release;
  transcriptionTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    let lastError = null;
    for (let attempt = 1; attempt <= TRANSCRIPTION_ATTEMPTS; attempt++) {
      try {
        return await transcribe(path);
      } catch (error) {
        lastError = error;
        if (attempt < TRANSCRIPTION_ATTEMPTS) await H.sleep(500 * attempt);
      }
    }
    throw lastError || new Error("independent ASR failed without an error");
  } finally {
    release();
  }
}

function inputTranscriptGrounded(transcript, spec) {
  if (spec.kind === "repeat") return /\brepeat\b.*\bweather\b/i.test(transcript);
  return containsExpectedCity(transcript, spec.city);
}

async function waitForInputDelivery(page, before, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const user = (await H.readMessages(page)).slice(before).find((message) => message.role === "user");
    if (user?.text?.trim()) return user.text.trim();
    await H.sleep(250);
  }
  return "";
}

function turnSpec(clientIndex, turnIndex) {
  const cityIndex = Math.floor(turnIndex / 2);
  const city = CITY_BANKS[clientIndex][cityIndex];
  const spokenCity = CITY_SPOKEN_SUBJECTS.get(city) || city;
  if (turnIndex === 0) return { city, prompt: `What is the current weather in ${city}?`, kind: "initial" };
  if (turnIndex % 2 === 1) return { city, prompt: "Repeat that weather.", kind: "repeat" };
  return { city, prompt: `How about ${spokenCity}?`, kind: "follow-up" };
}

function queryPath(clientIndex, turnIndex, spec) {
  if (spec.kind === "repeat") return `${OUT}/expect_tool_input_repeat.wav`;
  return `${OUT}/expect_tool_input_c${String(clientIndex + 1).padStart(2, "0")}_t${String(turnIndex + 1).padStart(2, "0")}.wav`;
}

async function synthesizeQueries() {
  fs.mkdirSync(OUT, { recursive: true });
  const generated = new Set();
  const paths = Array.from({ length: N }, () => []);
  for (let clientIndex = 0; clientIndex < N; clientIndex++) {
    for (let turnIndex = 0; turnIndex < TURNS; turnIndex++) {
      const spec = turnSpec(clientIndex, turnIndex);
      const path = queryPath(clientIndex, turnIndex, spec);
      paths[clientIndex][turnIndex] = path;
      if (generated.has(path)) continue;
      generated.add(path);
      let validated = false;
      for (let attempt = 1; attempt <= INPUT_SYNTH_ATTEMPTS; attempt++) {
        const reusable = attempt === 1 && fs.existsSync(path) && fs.statSync(path).size > 1000;
        if (!reusable) {
          await synthSpeech(spec.prompt, path, { instructions: INPUT_SPEECH_INSTRUCTIONS });
        }
        let transcript = "";
        let error = "";
        try {
          transcript = await transcribeWithRetry(path);
        } catch (transcriptionError) {
          error = String(transcriptionError);
        }
        const grounded = !error && inputTranscriptGrounded(transcript, spec);
        inputAudioValidation.push({
          path: path.replace(`${OUT}/`, ""),
          prompt: spec.prompt,
          expectedCity: spec.city,
          kind: spec.kind,
          attempt,
          reused: reusable,
          transcript,
          error,
          grounded,
        });
        if (grounded) {
          validated = true;
          break;
        }
      }
      if (!validated) {
        throw new Error(`could not synthesize grounded input audio for ${spec.prompt}`);
      }
    }
  }
  fs.writeFileSync(`${OUT}/input_audio_validation.json`, JSON.stringify(inputAudioValidation, null, 2));
  return paths;
}

async function prepareSession(clientIndex) {
  const slot = await H.createAudioSlot(clientIndex + 100);
  const signals = H.newSignals();
  const browser = await H.launchBrowser({ headless: false, env: slot.env });
  const { ctx, page } = await H.newPage(browser, signals, { viewport: { width: 900, height: 700 } });
  try {
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await H.selectExample(page, {
      example: "generic",
      model: "lightning",
      tts: TTS,
      tools: ["Weather"],
      consent: false,
    });
    const connection = await H.startConversation(page, { timeoutMs: 60000 });
    if (!connection.connected) throw new Error("session did not connect");
    await H.installToolWatch(page);
    if (!(await H.waitForSettledWelcome(page))) {
      throw new Error("welcome did not settle before query playback");
    }
    const sessionId = await H.sessionId(page);
    return { clientIndex, slot, signals, browser, ctx, page, connection, sessionId };
  } catch (error) {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
}

async function exerciseTurn(session, turnIndex, inputPath) {
  const { clientIndex, page, slot } = session;
  const spec = turnSpec(clientIndex, turnIndex);
  const listening = await H.waitListening(page, { timeoutMs: 35000 });
  const before = (await H.readMessages(page)).length;
  const toolMark = await H.toolWatchMark(page);
  await page.evaluate(() => window.__botReset());
  const startedAt = Date.now();
  const capturePromise = H.captureBot(
    page,
    `expect_tool_c${clientIndex + 1}_t${turnIndex + 1}_bot`,
    {
      monitor: slot.spkMonitor,
      maxMs: 75000,
      quietMs: 3500,
      requireListening: true,
      settleFromMessageCount: before,
      stableMs: 4500,
    },
  );
  await H.sleep(150);
  await execFileP("paplay", [`--device=${slot.micSink}`, inputPath]);
  let playbackAttempts = 1;
  let deliveredUser = await waitForInputDelivery(page, before);
  if (!deliveredUser) {
    playbackAttempts += 1;
    await execFileP("paplay", [`--device=${slot.micSink}`, inputPath]);
    deliveredUser = await waitForInputDelivery(page, before);
  }
  const firstCapture = await capturePromise;
  let completionCapture = null;
  const afterFirstCapture = (await H.readMessages(page)).slice(before);
  const firstDomBot = [...afterFirstCapture].reverse().find((message) => message.role === "bot")?.text || "";
  if (!containsExpectedCity(firstDomBot, spec.city)) {
    completionCapture = await H.captureBot(
      page,
      `expect_tool_c${clientIndex + 1}_t${turnIndex + 1}_completion_bot`,
      {
        monitor: slot.spkMonitor,
        maxMs: 75000,
        quietMs: 3500,
        requireListening: true,
        settleFromMessageCount: before,
        stableMs: 4500,
        allowTranscriptOnlyStop: false,
      },
    );
  }
  await H.waitListening(page, { timeoutMs: 15000 });
  await H.sleep(300);
  const capture = completionCapture?.sawOnset ? completionCapture : firstCapture;
  const botAsr = capture.sawOnset && capture.out
    ? await transcribeWithRetry(capture.out).catch((error) => `ASR-error:${error.message}`)
    : "";

  let current = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    current = (await H.readMessages(page)).slice(before);
    if (current.some((message) => message.role === "bot" && message.text.trim())) break;
    await H.sleep(500);
  }
  const domUser = current.find((message) => message.role === "user")?.text || "";
  const domBot = [...current].reverse().find((message) => message.role === "bot")?.text || "";
  const tools = await H.toolWatchSince(page, toolMark);
  const combinedAnswer = `${domBot} ${botAsr}`.trim();
  const foreignCities = [...new Set(CITY_BANKS.flat())].filter((city) => city !== spec.city);
  const leakedCities = foreignCities.filter((city) => containsExpectedCity(combinedAnswer, city));
  const expectedToolCalled = tools.some((tool) => tool.toLowerCase().includes(EXPECT_TOOL.toLowerCase()));
  const botAudio = firstCapture.sawOnset || Boolean(completionCapture?.sawOnset);
  const botAsrOk = Boolean(botAsr) && !botAsr.startsWith("ASR-error:");
  const botAsrGrounded = botAsrOk && containsExpectedCity(botAsr, spec.city);
  const ownCityGrounded = containsExpectedCity(combinedAnswer, spec.city);
  const silent = !botAudio && !domBot.trim();
  const inputDelivered = Boolean(deliveredUser || domUser.trim());

  return {
    client: clientIndex + 1,
    sessionId: session.sessionId,
    turn: turnIndex + 1,
    kind: spec.kind,
    prompt: spec.prompt,
    expectedCity: spec.city,
    heardByApp: domUser,
    answer: domBot,
    botAsr,
    tools,
    listening,
    inputDelivered,
    playbackAttempts,
    expectedToolCalled,
    botAudio,
    botAsrOk,
    botAsrGrounded,
    ownCityGrounded,
    silent,
    leakedCities,
    wallMs: Date.now() - startedAt,
    pass: listening && inputDelivered && expectedToolCalled && botAudio && botAsrGrounded && ownCityGrounded
      && !silent && leakedCities.length === 0,
  };
}

const report = {
  base: H.BASE,
  startedAt: new Date().toISOString(),
  configured: { sessions: N, turnsPerSession: TURNS, expectedTool: EXPECT_TOOL, tts: TTS },
  results: [],
  sessions: [],
};

const inputPaths = await synthesizeQueries();
const sessions = [];
try {
  const prepared = await Promise.allSettled(Array.from({ length: N }, (_, index) => prepareSession(index)));
  sessions.push(...prepared.filter((result) => result.status === "fulfilled").map((result) => result.value));
  const preparationFailures = prepared.filter((result) => result.status === "rejected");
  if (preparationFailures.length) {
    const details = preparationFailures.map((result) => String(result.reason)).join("; ");
    throw new Error(`${preparationFailures.length} session(s) failed to prepare: ${details}`);
  }
  const uniqueSessionIds = new Set(sessions.map((session) => session.sessionId).filter(Boolean));
  if (uniqueSessionIds.size !== N) throw new Error(`expected ${N} unique session IDs, got ${uniqueSessionIds.size}`);

  for (let turnIndex = 0; turnIndex < TURNS; turnIndex++) {
    const results = await Promise.all(sessions.map((session) =>
      exerciseTurn(session, turnIndex, inputPaths[session.clientIndex][turnIndex])));
    report.results.push(...results);
    for (const result of results) console.log(JSON.stringify(result));
  }
} catch (error) {
  report.fatal = String(error);
} finally {
  await Promise.all(sessions.map(async (session) => {
    await H.endConversation(session.page).catch(() => {});
    report.sessions.push({
      client: session.clientIndex + 1,
      sessionId: session.sessionId,
      consoleErrors: session.signals.consoleErrors,
      badResponses: session.signals.badResponses,
      wsClosures: session.signals.wsClosures,
    });
    await session.ctx.close().catch(() => {});
    await session.browser.close().catch(() => {});
  }));
}

const expectedTurns = N * TURNS;
const count = (predicate) => report.results.filter(predicate).length;
report.finishedAt = new Date().toISOString();
report.summary = {
  expectedTurns,
  completedTurns: report.results.length,
  expectedToolCalls: count((result) => result.expectedToolCalled),
  botAudioTurns: count((result) => result.botAudio),
  botAsrTurns: count((result) => result.botAsrOk),
  botAsrGroundedTurns: count((result) => result.botAsrGrounded),
  groundedTurns: count((result) => result.ownCityGrounded),
  silentTurns: count((result) => result.silent),
  crossTalkTurns: count((result) => result.leakedCities.length > 0),
  failedTurns: count((result) => !result.pass),
  consoleErrors: report.sessions.reduce((total, session) => total + session.consoleErrors.length, 0),
  wsClosures: report.sessions.reduce((total, session) => total + session.wsClosures.length, 0),
};
report.pass = !report.fatal
  && report.summary.completedTurns === expectedTurns
  && report.summary.expectedToolCalls === expectedTurns
  && report.summary.botAudioTurns === expectedTurns
  && report.summary.botAsrGroundedTurns === expectedTurns
  && report.summary.groundedTurns === expectedTurns
  && report.summary.silentTurns === 0
  && report.summary.crossTalkTurns === 0
  && report.summary.failedTurns === 0
  && report.summary.consoleErrors === 0
  && report.summary.wsClosures === 0;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/repeated_expect_tool_matrix_report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pass: report.pass, fatal: report.fatal || null, ...report.summary }));
process.exit(report.pass ? 0 : 1);
