// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Dual-orb canvas visualizer (ported from the ori VoiceChat UI). The right orb
// is the user (mic), the left orb is Nemotron (bot). A particle field, pulse
// rings, and a flowing "bridge" react to real-time audio energy. Rendered as a
// hero band above the transcript while a session is live.

import { useCallback, useEffect, useRef } from "react";
import { createNoise2D } from "../../demo/simplexNoise";
import {
  type Particle,
  DARK_PALETTE,
  NVIDIA_GREEN,
  NVIDIA_LIME,
  NVIDIA_BRIGHT,
  USER_GREEN,
  getEnergy,
  getBassEnergy,
  initParticles,
  initOrbState,
  smoothEnergy,
  updateNoiseFloor,
  trySpawnRing,
  lerpRgb,
  drawTriangleGrid,
  updateAndDrawParticles,
  updateAndDrawRings,
  drawOrbBlob,
  drawMuteRing,
  drawBridge,
} from "../../demo/orbEngine";

interface OrbVisualizerProps {
  userAnalyser: AnalyserNode | null;
  botAnalyser: AnalyserNode | null;
  micMuted?: boolean;
}

export function OrbVisualizer({ userAnalyser, botAnalyser, micMuted = false }: Readonly<OrbVisualizerProps>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef({ w: 0, h: 0 });

  const noiseRef = useRef(createNoise2D(42));
  const userOrbRef = useRef(initOrbState());
  const aiOrbRef = useRef(initOrbState());
  const particlesRef = useRef<Particle[]>([]);
  const startTimeRef = useRef(performance.now());
  const micMutedRef = useRef(micMuted);
  micMutedRef.current = micMuted;

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
      canvas.width = pw * dpr;
      canvas.height = ph * dpr;
      canvas.style.width = `${pw}px`;
      canvas.style.height = `${ph}px`;
      particlesRef.current = initParticles(pw, ph);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, pw, ph);

    const time = (performance.now() - startTimeRef.current) / 1000;
    const noise = noiseRef.current;
    const muted = micMutedRef.current;

    const rawUserE = getEnergy(userAnalyser);
    const rawAiE = getEnergy(botAnalyser);
    const bass = getBassEnergy(botAnalyser);

    const uOrb = userOrbRef.current;
    const aOrb = aiOrbRef.current;

    smoothEnergy(uOrb, muted ? 0 : rawUserE);
    smoothEnergy(aOrb, rawAiE);
    uOrb.frozen = muted;

    updateNoiseFloor(uOrb, rawUserE);
    const userThreshold = uOrb.noiseFloor * 1.5 + 0.05;
    const userActive = rawUserE > userThreshold;

    const userCx = pw * 0.72;
    const aiCx = pw * 0.28;
    const cy = ph * 0.5;
    const maxR = Math.min(ph * 0.45, 52);
    const now = performance.now();

    if (!muted) trySpawnRing(uOrb, userCx, cy, maxR, USER_GREEN, rawUserE, now);
    trySpawnRing(aOrb, aiCx, cy, maxR, NVIDIA_GREEN, rawAiE, now);

    const pal = DARK_PALETTE;
    const userColor = lerpRgb(pal.dimGray, USER_GREEN, uOrb.smoothedEnergy);
    const userHot = lerpRgb(USER_GREEN, NVIDIA_BRIGHT, uOrb.smoothedEnergy);
    const aiColor = lerpRgb(pal.brandDim, NVIDIA_GREEN, aOrb.smoothedEnergy);
    const aiHot = lerpRgb(NVIDIA_LIME, NVIDIA_BRIGHT, aOrb.smoothedEnergy);
    const combinedEnergy = Math.max(uOrb.smoothedEnergy, aOrb.smoothedEnergy);

    drawTriangleGrid(ctx, pw, ph, bass, combinedEnergy, pal);
    updateAndDrawParticles(
      ctx, particlesRef.current, pw, ph,
      userCx, cy, uOrb.smoothedEnergy, uOrb.prevSmoothed, userActive,
      aiCx, cy, aOrb.smoothedEnergy, aOrb.prevSmoothed, noise, time, pal,
    );
    updateAndDrawRings(ctx, uOrb.rings, pal);
    updateAndDrawRings(ctx, aOrb.rings, pal);
    drawOrbBlob(ctx, userCx, cy, uOrb.smoothedEnergy, maxR, userColor, userHot, noise, time, 0, uOrb.frozen, pal);
    drawOrbBlob(ctx, aiCx, cy, aOrb.smoothedEnergy, maxR, aiColor, aiHot, noise, time, 50, aOrb.frozen, pal);
    if (muted) drawMuteRing(ctx, userCx, cy, maxR, uOrb.smoothedEnergy);

    const aiSpeaking = aOrb.smoothedEnergy > 0.05;
    drawBridge(ctx, userCx, cy, aiCx, cy, uOrb.smoothedEnergy, aOrb.smoothedEnergy, userActive, aiSpeaking, time, noise, pal);
  }, [userAnalyser, botAnalyser]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
