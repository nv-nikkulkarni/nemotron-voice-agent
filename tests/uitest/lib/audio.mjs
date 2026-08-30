// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// External ASR/TTS via the NVIDIA inference hub (LiteLLM gateway), used to give
// the SQA harness a real voice (gpt-4o-mini-tts) and real ears (parakeet ASR).
// Same sk-* key as web_search. All audio is normalized to 16 kHz mono 16-bit PCM
// WAV — what both the browser fake mic and parakeet want.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { promises as fs } from "node:fs";
import path from "node:path";

const execFileP = promisify(execFile);

const BASE = process.env.SQA_INFER_BASE || "https://inference-api.nvidia.com/v1";
const KEY = process.env.SQA_KEY || "";
const TTS_MODEL = process.env.SQA_TTS_MODEL || "openai/openai/gpt-4o-mini-tts";
const ASR_PATH = process.env.SQA_ASR_PATH || "/audio/nvidia/parakeet-1-1b-ctc-en-us/transcriptions";
const TTS_VOICE = process.env.SQA_TTS_VOICE || "coral";

if (!KEY) console.warn("[audio] SQA_KEY not set — ASR/TTS calls will 401");

// Resample/convert any input to 16 kHz mono 16-bit PCM WAV.
export async function to16kMonoWav(inPath, outPath) {
  await execFileP("ffmpeg", ["-y", "-i", inPath, "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", "-f", "wav", outPath]);
  return outPath;
}

// Synthesize `text` to a 16 kHz mono WAV at outWav. Returns { outWav, durationSec }.
export async function synthSpeech(text, outWav, { voice = TTS_VOICE, instructions } = {}) {
  const body = { model: TTS_MODEL, input: text, voice, response_format: "wav" };
  if (instructions) body.instructions = instructions;
  const res = await fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const tmp = `${outWav}.raw.wav`;
  await writeFile(tmp, raw);
  await to16kMonoWav(tmp, outWav);
  await fs.unlink(tmp).catch(() => {});
  return { outWav, durationSec: await wavDuration(outWav) };
}

// Transcribe a WAV (any rate) via parakeet. Returns lowercased text.
export async function transcribe(wavPath) {
  const norm = `${wavPath}.16k.wav`;
  await to16kMonoWav(wavPath, norm);
  const buf = await readFile(norm);
  await fs.unlink(norm).catch(() => {});
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "audio/wav" }), "audio.wav");
  fd.append("language", "en-US");
  const res = await fetch(`${BASE}${ASR_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`ASR HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.text || "").trim();
}

// Duration (sec) of a PCM WAV by reading its header.
export async function wavDuration(wavPath) {
  const b = await readFile(wavPath);
  // walk chunks to find 'data' + 'fmt '
  let byteRate = 0, dataLen = 0, i = 12;
  while (i + 8 <= b.length) {
    const id = b.toString("ascii", i, i + 4);
    const sz = b.readUInt32LE(i + 4);
    if (id === "fmt ") byteRate = b.readUInt32LE(i + 8 + 8);
    if (id === "data") { dataLen = sz; break; }
    i += 8 + sz + (sz & 1);
  }
  return byteRate ? dataLen / byteRate : 0;
}

export function paths(dir, name) {
  return { wav: path.join(dir, `${name}.wav`) };
}
