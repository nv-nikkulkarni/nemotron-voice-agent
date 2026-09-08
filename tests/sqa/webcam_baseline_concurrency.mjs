// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Four simultaneous Omni sessions must establish distinct webcam baselines
// without leaking another session's scene.
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as H from "./lib/harness.mjs";

const execFileP = promisify(execFile);
const OUT = process.env.SQA_OUT || "/sqa/out";
const SPECS = [
  { color: "red", slot: 31 },
  { color: "blue", slot: 32 },
  { color: "green", slot: 33 },
  { color: "yellow", slot: 34 },
];

async function makeFixture(spec) {
  const path = `${OUT}/webcam-${spec.color}.jpg`;
  await execFileP("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `color=c=${spec.color}:s=640x480:d=0.1`,
    "-vf", "drawbox=x=180:y=120:w=280:h=240:color=white:t=fill",
    "-frames:v", "1", "-q:v", "2", path,
  ]);
  return fs.readFileSync(path);
}

async function waitForGroundedDescription(page, before, color, maxMs = 50000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const messages = (await H.readMessages(page)).slice(before);
    const grounded = [...messages].reverse().find(
      (message) => message.role === "bot" && new RegExp(`\\b${color}\\b`, "i").test(message.text),
    );
    if (grounded) return grounded.text;
    await H.sleep(750);
  }
  return "";
}

async function waitForBaselinePanel(page, color, firstFrameAt, maxMs = 10000) {
  const deadline = firstFrameAt + maxMs;
  const panel = page.locator(".webcam-agent-update p").last();
  while (Date.now() < deadline) {
    const observation = await panel.innerText().catch(() => "");
    if (new RegExp(`\\b${color}\\b`, "i").test(observation)) {
      return { observation, elapsedMs: Date.now() - firstFrameAt };
    }
    await H.sleep(200);
  }
  return { observation: "", elapsedMs: null };
}

async function uploadFrameWithRetry(page, sessionId, fixture, options) {
  let response = { status: 0, body: "not attempted" };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    response = await H.uploadWebcamFrame(page, sessionId, fixture, options);
    if (response.status >= 200 && response.status < 300) return { ...response, attempts: attempt };
    if (attempt < 2) await H.sleep(350);
  }
  return { ...response, attempts: 2 };
}

async function runOne(spec) {
  const sig = H.newSignals();
  const slot = await H.createAudioSlot(spec.slot);
  const browser = await H.launchBrowser({ headless: false, env: slot.env });
  const result = {
    color: spec.color,
    connected: false,
    sessionId: "",
    frameStatuses: [],
    baselineEstablishedMs: null,
    baselineObservation: "",
    botAudio: false,
    description: "",
    leakedColors: [],
    consoleErrors: [],
    wsClosures: [],
    pass: false,
  };
  try {
    const { page } = await H.newPage(browser, sig);
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    await H.sleep(1200);
    await H.selectExample(page, { example: "omni", tts: "magpie" });
    const connection = await H.startConversation(page, { timeoutMs: 45000 });
    result.connected = connection.connected;
    result.sessionId = await H.sessionId(page);
    if (!connection.connected || !(await H.waitForSettledWelcome(page))) return result;

    const fixture = await makeFixture(spec);
    const firstFrameAt = Date.now();
    for (let frame = 0; frame < 6; frame += 1) {
      const response = await uploadFrameWithRetry(page, result.sessionId, fixture, {
        name: `webcam-${spec.color}-${frame}.jpg`,
        type: "image/jpeg",
      });
      result.frameStatuses.push({ status: response.status, attempts: response.attempts });
      await H.sleep(650);
    }
    const baseline = await waitForBaselinePanel(page, spec.color, firstFrameAt);
    result.baselineEstablishedMs = baseline.elapsedMs;
    result.baselineObservation = baseline.observation;
    const before = (await H.readMessages(page)).length;
    const turn = await H.turn(
      page,
      "What dominant background color and simple shape do you see on my camera right now?",
      `webcam_${spec.color}`,
      {
        micDevice: slot.micSink,
        spkDevice: slot.spkSink,
        monitor: slot.spkMonitor,
        settle: true,
        settleStableMs: 6000,
      },
    );
    result.botAudio = turn.botSpoke;
    result.description = await waitForGroundedDescription(page, before, spec.color);
    const foreign = SPECS.map((candidate) => candidate.color).filter((color) => color !== spec.color);
    result.leakedColors = foreign.filter(
      (color) => new RegExp(`\\b${color}\\b`, "i").test(result.description),
    );
    result.pass = result.connected
      && result.sessionId.length > 0
      && result.frameStatuses.every(({ status }) => status >= 200 && status < 300)
      && result.baselineEstablishedMs !== null
      && result.baselineEstablishedMs <= 10000
      && result.botAudio
      && new RegExp(`\\b${spec.color}\\b`, "i").test(result.description)
      && result.leakedColors.length === 0
      && sig.consoleErrors.length === 0
      && sig.wsClosures.length === 0;
    await H.endConversation(page);
    await page.context().close().catch(() => {});
    return result;
  } catch (error) {
    result.error = String(error);
    return result;
  } finally {
    result.consoleErrors = sig.consoleErrors;
    result.wsClosures = sig.wsClosures;
    await browser.close().catch(() => {});
  }
}

fs.mkdirSync(OUT, { recursive: true });
const report = {
  runId: H.RUN_ID,
  at: new Date().toISOString(),
  base: H.BASE,
  requirement: "four distinct webcam baselines initiated within 10 seconds with no scene leakage",
  sessions: await Promise.all(SPECS.map(runOne)),
};
report.uniqueSessionIds = new Set(report.sessions.map((session) => session.sessionId)).size;
report.pass = report.sessions.every((session) => session.pass) && report.uniqueSessionIds === SPECS.length;
fs.writeFileSync(`${OUT}/webcam_baseline_concurrency_report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
process.exitCode = report.pass ? 0 : 1;
