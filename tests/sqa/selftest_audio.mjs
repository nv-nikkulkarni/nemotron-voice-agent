// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Layer-1 self-test: TTS -> play into spk_sink -> record spk_sink.monitor -> ASR.
// Proves the external voice/ears + the virtual audio routing work before we add
// the browser. Run inside the harness container via run.sh.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { synthSpeech, transcribe } from "./lib/audio.mjs";
const execFileP = promisify(execFile);

async function main() {
  const dir = "/sqa/out";
  const phrase = "What is natural language processing";
  console.log(`[selftest] synth: "${phrase}"`);
  const { outWav, durationSec } = await synthSpeech(phrase, `${dir}/say.wav`);
  console.log(`[selftest] tts wav ${durationSec.toFixed(2)}s -> ${outWav}`);

  // Record spk_sink.monitor while we play the phrase into spk_sink.
  const capWav = `${dir}/heard.wav`;
  const rec = execFile("ffmpeg", ["-y", "-f", "pulse", "-i", "spk_sink.monitor",
    "-t", String(Math.ceil(durationSec) + 1), "-ac", "1", "-ar", "16000", capWav]);
  await new Promise((r) => setTimeout(r, 300)); // let recorder attach
  await execFileP("paplay", ["--device=spk_sink", outWav]);
  await new Promise((res, rej) => { rec.on("exit", (c) => (c === 0 ? res() : rej(new Error("ffmpeg rec " + c)))); });

  console.log("[selftest] transcribing captured audio...");
  const heard = await transcribe(capWav);
  console.log(`[selftest] ASR heard: "${heard}"`);
  const ok = heard.toLowerCase().includes("natural language");
  console.log(ok ? "[selftest] PASS ✅  round-trip TTS->audio->ASR works" : "[selftest] FAIL ❌");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("[selftest] ERROR", e); process.exit(1); });
