// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Conversation-page hero: a glowing green particle ring that morphs SMOOTHLY with
// the audio. Instead of mapping raw waveform samples to the radius (jagged), the
// ring radius is a few low harmonic sine lobes (2/3/5) whose amplitudes are driven
// by the bass / mid / treble bands of the live sound — so it's always smooth (built
// from sines), reactive (bands), and calm.
//   • silent / muted / low sound → a clean near-flat circle (a faint breath only).
//   • sound (you or the agent) → smooth lobes bloom/flow, sized by the spectrum;
//     sensitive to quiet sound, but gentle.
//   • "thinking" (you finished, awaiting the agent) → a slow rotating lobed pulse.
// All amplitudes/rotation ease between states for fluidity; additive blending +
// transparent canvas blend it into the page.

import { useCallback, useEffect, useRef } from "react";

interface Props {
  userAnalyser: AnalyserNode | null;
  botAnalyser?: AnalyserNode | null;
  /** True between "you stopped speaking" and the agent's first audio. */
  thinking?: boolean;
}

interface SpectrumStore {
  buf: Uint8Array<ArrayBuffer> | null;
}

/** Read the frequency spectrum → 3 band levels (bass/mid/treble) + overall energy. */
function readSpectrum(
  a: AnalyserNode | null,
  store: SpectrumStore,
): { bands: [number, number, number]; energy: number } {
  if (!a) return { bands: [0, 0, 0], energy: 0 };
  const n = a.frequencyBinCount;
  if (!store.buf || store.buf.length !== n) store.buf = new Uint8Array(n);
  a.getByteFrequencyData(store.buf);
  const buf = store.buf;
  const avg = (lo: number, hi: number) => {
    const top = Math.min(hi, n);
    let s = 0;
    for (let i = lo; i < top; i++) s += buf[i];
    return s / (Math.max(1, top - lo) * 255);
  };
  return { bands: [avg(1, 10), avg(10, 35), avg(35, 90)], energy: avg(1, 90) };
}

const STRANDS = 4;
const SAMPLES = 220;
const TWO_PI = Math.PI * 2;
const GATE = 0.03; // below this (boosted) intensity the ring is treated as silent
const FLOOR = 0.02; // spectrum energy below this is ignored (ambient)
const SENS_GAIN = 9; // sensitivity: higher = picks up quieter sounds
const BAND_BOOST = 1.8; // per-band sensitivity (quiet sounds still form lobes)
const WOBBLE = 0.1; // lobe depth (subtle)

export function SphereWaveVisualizer({ userAnalyser, botAnalyser = null, thinking = false }: Readonly<Props>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const tRef = useRef(0);
  const intenRef = useRef(0);
  const rotVelRef = useRef(0);
  const rotRef = useRef(0);
  const thinkRef = useRef(0);
  const bandRef = useRef<number[]>([0, 0, 0]);
  const userStore = useRef<SpectrumStore>({ buf: null });
  const botStore = useRef<SpectrumStore>({ buf: null });
  const thinkingRef = useRef(thinking);
  thinkingRef.current = thinking;

  const render = useCallback(() => {
    rafRef.current = requestAnimationFrame(render);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    if (pw === 0 || ph === 0) return;
    if (pw !== sizeRef.current.w || ph !== sizeRef.current.h) {
      sizeRef.current = { w: pw, h: ph };
      canvas.width = Math.round(pw * dpr);
      canvas.height = Math.round(ph * dpr);
      canvas.style.width = `${pw}px`;
      canvas.style.height = `${ph}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, pw, ph);

    const cx = pw / 2;
    const cy = ph / 2;
    const isThinking = thinkingRef.current;

    const u = readSpectrum(userAnalyser, userStore.current);
    const b = readSpectrum(botAnalyser, botStore.current);
    const useBot = b.energy > u.energy * 1.2 && b.energy > 0.012;
    const src = useBot ? b : u;

    // Sensitive intensity: tiny floor + sqrt curve so quiet sounds read clearly.
    const eAbove = Math.max(0, src.energy - FLOOR);
    const rawInten = Math.min(1, Math.sqrt(eAbove * SENS_GAIN));
    const k = rawInten > intenRef.current ? 0.45 : 0.1;
    intenRef.current += (rawInten - intenRef.current) * k;
    const inten = intenRef.current;
    const active = inten > GATE;

    thinkRef.current += ((isThinking ? 1 : 0) - thinkRef.current) * 0.08;
    const think = thinkRef.current;

    // Gentle rotation, only when there is sound (or thinking).
    let rotTarget = 0;
    if (isThinking) rotTarget = 0.4;
    else if (active) rotTarget = 0.12 + inten * 0.55;
    rotVelRef.current += (rotTarget - rotVelRef.current) * 0.05;
    rotRef.current += rotVelRef.current * 0.016;
    const rot = rotRef.current;

    // Smoothed, boosted, gated band amplitudes → the lobe sizes.
    const gateOn = active && think < 0.5;
    const bands = bandRef.current;
    for (let bi = 0; bi < 3; bi++) {
      const target = gateOn ? Math.min(1, Math.sqrt(src.bands[bi]) * BAND_BOOST) : 0;
      const bk = target > bands[bi] ? 0.4 : 0.1;
      bands[bi] += (target - bands[bi]) * bk;
    }
    const [ba, bm, bt] = bands;

    tRef.current += 0.016;
    const t = tRef.current;
    const R = Math.min(pw, ph) * 0.34 * (1 + inten * 0.05 + think * 0.03);

    // --- glow (subtle at rest, blooms with intensity / thinking) ---
    const glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.5);
    const glowA = 0.05 + inten * 0.3 + think * 0.14;
    glow.addColorStop(0, `rgba(118,185,0,${glowA * 0.5})`);
    glow.addColorStop(0.6, `rgba(118,185,0,${glowA})`);
    glow.addColorStop(1, "rgba(118,185,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, pw, ph);

    // --- the ring ---
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let s = 0; s < STRANDS; s++) {
      const baseR = R * (0.92 + s * 0.032);
      const sp = s * 0.8;
      const breath = R * 0.008 * Math.sin(t * 0.5 + sp); // faint life when silent
      for (let i = 0; i < SAMPLES; i++) {
        const theta = (i / SAMPLES) * TWO_PI;
        // smooth spectral lobes: few low harmonics, each sized by a band, slowly flowing
        let disp =
          (ba * Math.sin(2 * theta + t * 0.28 + sp) +
            bm * Math.sin(3 * theta - t * 0.22 + sp * 1.3) +
            bt * Math.sin(5 * theta + t * 0.34)) *
          R *
          WOBBLE;
        // thinking motion — smooth rotating lobes
        if (think > 0.01) {
          const lobe = Math.sin(2 * theta + rot * 1.6 + sp) * 0.6 + Math.sin(3 * theta - rot * 1.1) * 0.4;
          disp += lobe * R * 0.08 * think;
        }
        const r = baseR + disp + breath;
        const a = theta + rot;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        const shim = 0.5 + 0.5 * Math.sin(theta * 2 - t * 1.0 + sp);
        const rad = 0.55 + shim * 1.4;
        const green = 150 + Math.round(shim * 95);
        const red = 55 + Math.round(shim * 115);
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, TWO_PI);
        ctx.fillStyle = `rgba(${red},${green},40,${0.09 + shim * 0.5})`;
        ctx.fill();
      }
    }
    ctx.restore();
  }, [userAnalyser, botAnalyser]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
