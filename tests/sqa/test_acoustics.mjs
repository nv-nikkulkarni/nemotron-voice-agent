// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { detectAudibleWav } from "./lib/acoustics.mjs";

const execFileP = promisify(execFile);

async function synthFixture(output, source) {
  await execFileP("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-f", "lavfi",
    "-i", source,
    "-t", "0.4",
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "pcm_s16le",
    output,
  ]);
}

test("recorded tone is audible and recorded silence is not", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nva-sqa-acoustics-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tone = path.join(dir, "tone.wav");
  const silence = path.join(dir, "silence.wav");

  await synthFixture(tone, "sine=frequency=440:sample_rate=16000");
  await synthFixture(silence, "anullsrc=r=16000:cl=mono");

  const toneResult = await detectAudibleWav(tone);
  const silenceResult = await detectAudibleWav(silence);

  assert.equal(toneResult.error, "");
  assert.equal(toneResult.audible, true);
  assert.equal(silenceResult.error, "");
  assert.equal(silenceResult.audible, false);
});
