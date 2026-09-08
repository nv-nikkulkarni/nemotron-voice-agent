// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Acoustic evidence helpers for recorded SQA bot audio.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const MAX_VOLUME_RE = /max_volume:\s*(-?inf|[-+]?\d+(?:\.\d+)?)\s*dB/i;

export async function detectAudibleWav(
  wavPath,
  { thresholdDb = Number(process.env.SQA_AUDIO_THRESHOLD_DB || "-50") } = {},
) {
  try {
    const { stderr = "" } = await execFileP("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-i", wavPath,
      "-af", "volumedetect",
      "-f", "null",
      "-",
    ]);
    const match = String(stderr).match(MAX_VOLUME_RE);
    const token = match?.[1]?.toLowerCase();
    const maxVolumeDb = token === "-inf" || token === "inf" ? -Infinity : Number(token);
    return {
      audible: Number.isFinite(maxVolumeDb) && maxVolumeDb >= thresholdDb,
      maxVolumeDb,
      error: "",
    };
  } catch (error) {
    return { audible: false, maxVolumeDb: null, error: String(error?.message || error) };
  }
}
