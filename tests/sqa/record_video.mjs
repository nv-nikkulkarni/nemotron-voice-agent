// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Records a real spoken conversation with the live Generic Assistant to an mp4:
// ffmpeg captures the Xvfb screen (x11grab) + the mixed conversation audio
// (spk_sink.monitor — both the bot's voice and, echoed in, our TTS voice). Same
// browser path the SQA suites drive, so the video is a faithful demo of the
// deployment under test.
//
//   node record_video.mjs
import fs from "node:fs";
import { execFile, spawn } from "node:child_process";
import * as H from "./lib/harness.mjs";

const VIDEO_DIR = process.env.SQA_VIDEO || "/sqa/video";
const DISPLAY = process.env.DISPLAY || ":99";

const SCRIPT = [
  "Hi Nemotron! Can you introduce yourself in one sentence?",
  "What's the weather in San Francisco right now?",
  "Nice. Now convert two hundred and fifty US dollars to euros.",
  "What's one recent NVIDIA news headline?",
  "Perfect, thank you. Goodbye!",
];

async function main() {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const mp4 = `${VIDEO_DIR}/generic_conversation.mp4`;
  const sig = H.newSignals();
  const browser = await H.launchBrowser({ headless: false, extraArgs: ["--window-position=0,0", "--window-size=1280,800", "--start-fullscreen", "--kiosk"] });
  const { page } = await H.newPage(browser, sig, { viewport: { width: 1280, height: 800 } });
  await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await H.sleep(1500);
  await H.selectExample(page, { example: "generic", model: "super" });
  const conn = await H.startConversation(page);
  if (!conn.connected) { console.error("did not connect"); await browser.close(); process.exit(1); }
  await H.sleep(1200);

  // Start screen+audio recording.
  console.log("[video] recording -> " + mp4);
  const ff = spawn("ffmpeg", ["-y",
    "-thread_queue_size", "1024", "-f", "x11grab", "-framerate", "25", "-video_size", "1280x800", "-i", DISPLAY,
    "-thread_queue_size", "1024", "-f", "pulse", "-i", "spk_sink.monitor",
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", mp4],
    { stdio: ["ignore", "inherit", "inherit"] });
  await H.sleep(1000);

  const turns = [];
  for (let i = 0; i < SCRIPT.length; i++) {
    console.log(`[video] turn ${i + 1}/${SCRIPT.length}: ${SCRIPT[i]}`);
    const r = await H.turn(page, SCRIPT[i], `vid_t${i + 1}`, { echoToSpk: true });
    turns.push({ user: SCRIPT[i], botSpoke: r.botSpoke, heard: r.botAsr, latencyS: r.latencyS });
    await H.sleep(700);
  }
  await H.endConversation(page);
  await H.sleep(1200);

  // Stop recording cleanly.
  ff.kill("SIGINT");
  await new Promise((res) => ff.on("exit", res));
  await browser.close().catch(() => {});

  const meta = await new Promise((res) => execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration,size", "-of", "default=nw=1", mp4], (e, o) => res(o || "")));
  console.log("\n[video] DONE");
  console.log(meta.trim());
  turns.forEach((t, i) => console.log(`  turn ${i + 1}: spoke=${t.botSpoke} lat=${t.latencyS}s heard="${(t.heard || "").slice(0, 60)}"`));
  fs.writeFileSync(`${VIDEO_DIR}/conversation_meta.json`, JSON.stringify({ mp4, at: new Date().toISOString(), turns, signals: sig }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error("[video] ERROR", e); process.exit(1); });
