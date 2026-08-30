// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Ported from the ori VoiceChat UI (dual-orb canvas visualizer). Self-contained:
// the caller supplies audio AnalyserNodes and a 2D simplex-noise function.

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function buildPerm(seed: number): Uint8Array {
  const p = new Uint8Array(512);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i++) source[i] = i;
  let s = seed | 0;
  for (let i = 255; i >= 0; i--) {
    s = (s * 16807 + 0) & 0x7fffffff;
    const j = s % (i + 1);
    p[i] = p[i + 256] = source[j];
    source[j] = source[i];
  }
  return p;
}

export function createNoise2D(seed = 0) {
  const perm = buildPerm(seed);

  return function noise2D(x: number, y: number): number {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n = 0;

    let d = 0.5 - x0 * x0 - y0 * y0;
    if (d > 0) {
      const gi = perm[ii + perm[jj]] & 7;
      d *= d;
      n += d * d * (GRAD[gi][0] * x0 + GRAD[gi][1] * y0);
    }

    d = 0.5 - x1 * x1 - y1 * y1;
    if (d > 0) {
      const gi = perm[ii + i1 + perm[jj + j1]] & 7;
      d *= d;
      n += d * d * (GRAD[gi][0] * x1 + GRAD[gi][1] * y1);
    }

    d = 0.5 - x2 * x2 - y2 * y2;
    if (d > 0) {
      const gi = perm[ii + 1 + perm[jj + 1]] & 7;
      d *= d;
      n += d * d * (GRAD[gi][0] * x2 + GRAD[gi][1] * y2);
    }

    return 70 * n;
  };
}
