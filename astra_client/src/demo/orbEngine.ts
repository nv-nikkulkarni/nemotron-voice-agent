// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Ported from the ori VoiceChat UI (dual-orb canvas visualizer). Self-contained:
// the caller supplies audio AnalyserNodes and a 2D simplex-noise function.

/* ------------------------------------------------------------------ */
/*  Color helpers                                                      */
/* ------------------------------------------------------------------ */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

export function rgbStr(c: RGB, alpha = 1): string {
  return `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${alpha})`;
}

/* ------------------------------------------------------------------ */
/*  Color constants                                                    */
/* ------------------------------------------------------------------ */

export const NVIDIA_GREEN = hexToRgb("#76b900");
export const NVIDIA_LIME = hexToRgb("#a5de15");
export const NVIDIA_BRIGHT = hexToRgb("#cfff40");
export const USER_GREEN = hexToRgb("#3ae3c9");
export const RED_MUTE = hexToRgb("#fe3f3f");

const NVIDIA_GREEN_DARK = hexToRgb("#4a8000");
const USER_GREEN_DARK = hexToRgb("#1a9a80");

/* ------------------------------------------------------------------ */
/*  Theme palette                                                      */
/* ------------------------------------------------------------------ */

export interface ThemePalette {
  dimGray: RGB;
  brandDim: RGB;
  gridColor: RGB;
  gridAccent: RGB;
  gridBaseAlpha: number;
  gridBassBoost: number;
  gridLineWidth: number;
  glowAlpha: number;
  solidAlpha: number;
  particleNvidia: RGB;
  particleUser: RGB;
}

export const DARK_PALETTE: ThemePalette = {
  dimGray: hexToRgb("#222222"),
  brandDim: hexToRgb("#193800"),
  gridColor: NVIDIA_GREEN,
  gridAccent: NVIDIA_LIME,
  gridBaseAlpha: 0.04,
  gridBassBoost: 0.12,
  gridLineWidth: 0.6,
  glowAlpha: 1.0,
  solidAlpha: 1.0,
  particleNvidia: NVIDIA_GREEN,
  particleUser: USER_GREEN,
};

export const LIGHT_PALETTE: ThemePalette = {
  dimGray: hexToRgb("#666666"),
  brandDim: hexToRgb("#2d5a10"),
  gridColor: hexToRgb("#1a5500"),
  gridAccent: hexToRgb("#3a7a00"),
  gridBaseAlpha: 0.45,
  gridBassBoost: 0.35,
  gridLineWidth: 1.2,
  glowAlpha: 6.0,
  solidAlpha: 2.5,
  particleNvidia: NVIDIA_GREEN_DARK,
  particleUser: USER_GREEN_DARK,
};

/* ------------------------------------------------------------------ */
/*  Tuning constants                                                   */
/* ------------------------------------------------------------------ */

const ORB_POINTS = 80;
const NOISE_SCALE = 2.2;
export const PARTICLE_COUNT = 40;
const MAX_RINGS_PER_ORB = 8;
const RING_SPAWN_THRESHOLD = 0.08;
const RING_SPAWN_COOLDOWN_MS = 120;
const RING_MAX_RADIUS = 55;
const RING_EXPAND_SPEED = 0.8;
const TRIANGLE_SIDE = 20;
const BRIDGE_MIN_ENERGY = 0.12;
const BRIDGE_PARTICLE_COUNT = 12;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PulseRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: RGB;
  speed: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  homeX: number;
  homeY: number;
  size: number;
  baseAlpha: number;
  color: RGB;
  rotation: number;
  rotationSpeed: number;
}

export interface OrbState {
  smoothedEnergy: number;
  prevSmoothed: number;
  prevEnergy: number;
  lastRingTime: number;
  rings: PulseRing[];
  frozen: boolean;
  recentPeak: number;
  noiseFloor: number;
}

/* ------------------------------------------------------------------ */
/*  Audio energy extraction                                            */
/* ------------------------------------------------------------------ */

const freqBuf = new Uint8Array(256);

export function getEnergy(analyser: AnalyserNode | null): number {
  if (!analyser) return 0;
  analyser.getByteFrequencyData(freqBuf);
  let sum = 0;
  for (let i = 0; i < freqBuf.length; i++) sum += freqBuf[i] * freqBuf[i];
  const rms = Math.sqrt(sum / freqBuf.length);
  return Math.min(1, Math.max(0, rms / 128));
}

export function getBassEnergy(analyser: AnalyserNode | null): number {
  if (!analyser) return 0;
  analyser.getByteFrequencyData(freqBuf);
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += freqBuf[i];
  return Math.min(1, sum / (8 * 255));
}

/* ------------------------------------------------------------------ */
/*  Init helpers                                                       */
/* ------------------------------------------------------------------ */

export function initParticles(w: number, h: number): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const px = Math.random() * w;
    const py = Math.random() * h;
    out.push({
      x: px,
      y: py,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      homeX: px,
      homeY: py,
      size: 2 + Math.random() * 3,
      baseAlpha: 0.15 + Math.random() * 0.25,
      color: Math.random() < 0.5 ? { ...USER_GREEN } : { ...NVIDIA_GREEN },
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.03,
    });
  }
  return out;
}

export function initOrbState(): OrbState {
  return {
    smoothedEnergy: 0,
    prevSmoothed: 0,
    prevEnergy: 0,
    lastRingTime: 0,
    rings: [],
    frozen: false,
    recentPeak: 0,
    noiseFloor: 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Drawing: triangle grid                                             */
/* ------------------------------------------------------------------ */

export function drawTriangleGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bass: number,
  combinedEnergy: number,
  palette: ThemePalette,
) {
  const side = TRIANGLE_SIDE;
  const halfH = (side * Math.sqrt(3)) / 2;
  const baseAlpha = palette.gridBaseAlpha + combinedEnergy * 0.03;
  const boostedAlpha = baseAlpha + bass * palette.gridBassBoost;

  ctx.strokeStyle = rgbStr(palette.gridColor, boostedAlpha);
  ctx.lineWidth = palette.gridLineWidth + bass * 0.4;
  ctx.beginPath();

  for (let row = -1; row * halfH < h + halfH; row++) {
    const y = row * halfH;
    const offset = row % 2 === 0 ? 0 : side / 2;
    for (let col = -1; col * side < w + side; col++) {
      const x = col * side + offset;
      ctx.moveTo(x, y);
      ctx.lineTo(x + side, y);
      ctx.lineTo(x + side / 2, y + halfH);
      ctx.closePath();
    }
  }
  ctx.stroke();

  if (bass > 0.3) {
    ctx.strokeStyle = rgbStr(palette.gridAccent, (bass - 0.3) * 0.08 * palette.solidAlpha);
    ctx.lineWidth = 0.3;
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/*  Drawing: orb blob                                                  */
/* ------------------------------------------------------------------ */

export function drawOrbBlob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  energy: number,
  maxR: number,
  color: RGB,
  hotColor: RGB,
  noise: (x: number, y: number) => number,
  time: number,
  seed: number,
  frozen: boolean,
  palette: ThemePalette,
) {
  const minR = maxR * 0.18;
  const radius = minR + energy * (maxR - minR);
  const noiseAmp = 1 + energy * 28;
  const noiseSpeed = 0.4 + energy * 0.6;
  const t = frozen ? 0 : time;

  const points: [number, number][] = [];
  for (let i = 0; i < ORB_POINTS; i++) {
    const angle = (i / ORB_POINTS) * Math.PI * 2;
    const n = noise(
      Math.cos(angle) * NOISE_SCALE + t * noiseSpeed + seed,
      Math.sin(angle) * NOISE_SCALE + t * (noiseSpeed * 0.7) + seed,
    );
    const r = radius + n * noiseAmp;
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }

  const buildPath = (scale: number) => {
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [px, py] = points[i];
      const sx = cx + (px - cx) * scale;
      const sy = cy + (py - cy) * scale;
      const [nx, ny] = points[(i + 1) % points.length];
      const snx = cx + (nx - cx) * scale;
      const sny = cy + (ny - cy) * scale;
      if (i === 0) ctx.moveTo(sx, sy);
      const mx = (sx + snx) / 2;
      const my = (sy + sny) / 2;
      ctx.quadraticCurveTo(sx, sy, mx, my);
    }
    ctx.closePath();
  };

  const alpha = 0.3 + energy * 0.7;
  const ga = palette.glowAlpha;
  const sa = palette.solidAlpha;
  const clamp1 = (v: number) => Math.min(v, 1);

  buildPath(2.2);
  const g4 = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.2);
  g4.addColorStop(0, rgbStr(color, clamp1(0.04 * alpha * ga)));
  g4.addColorStop(1, rgbStr(color, 0));
  ctx.fillStyle = g4;
  ctx.fill();

  buildPath(1.7);
  const g3 = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.7);
  g3.addColorStop(0, rgbStr(color, clamp1(0.12 * alpha * ga)));
  g3.addColorStop(1, rgbStr(color, 0));
  ctx.fillStyle = g3;
  ctx.fill();

  buildPath(1.35);
  const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.35);
  g2.addColorStop(0, rgbStr(color, clamp1(0.35 * alpha * ga)));
  g2.addColorStop(0.6, rgbStr(color, clamp1(0.12 * alpha * ga)));
  g2.addColorStop(1, rgbStr(color, 0));
  ctx.fillStyle = g2;
  ctx.fill();

  buildPath(1);
  const g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g1.addColorStop(0, rgbStr(hotColor, clamp1(0.95 * alpha * sa)));
  g1.addColorStop(0.25, rgbStr(lerpRgb(hotColor, color, 0.3), clamp1(0.8 * alpha * sa)));
  g1.addColorStop(0.6, rgbStr(color, clamp1(0.5 * alpha * sa)));
  g1.addColorStop(1, rgbStr(color, clamp1(0.12 * alpha * ga)));
  ctx.fillStyle = g1;
  ctx.fill();
}

/* ------------------------------------------------------------------ */
/*  Drawing: mute ring                                                 */
/* ------------------------------------------------------------------ */

export function drawMuteRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
  energy: number,
) {
  const minR = maxR * 0.18;
  const r = minR + energy * (maxR - minR) + 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = rgbStr(RED_MUTE, 0.6);
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/*  Drawing: pulse rings                                               */
/* ------------------------------------------------------------------ */

export function updateAndDrawRings(
  ctx: CanvasRenderingContext2D,
  rings: PulseRing[],
  palette: ThemePalette,
) {
  const ga = palette.glowAlpha;
  const sa = palette.solidAlpha;
  for (let i = rings.length - 1; i >= 0; i--) {
    const ring = rings[i];
    ring.radius += ring.speed;
    const progress = ring.radius / ring.maxRadius;
    if (progress >= 1) {
      rings.splice(i, 1);
      continue;
    }
    const alpha = (1 - progress) * 0.7;

    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.strokeStyle = rgbStr(ring.color, Math.min(alpha * 0.15 * ga, 1));
    ctx.lineWidth = 4 + (1 - progress) * 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.strokeStyle = rgbStr(ring.color, Math.min(alpha * sa, 1));
    ctx.lineWidth = 1.8 - progress * 0.8;
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/*  Drawing: particles                                                 */
/* ------------------------------------------------------------------ */

export function updateAndDrawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  w: number,
  h: number,
  userCx: number,
  userCy: number,
  userEnergy: number,
  userPrevEnergy: number,
  userActive: boolean,
  aiCx: number,
  aiCy: number,
  aiEnergy: number,
  aiPrevEnergy: number,
  noise: (x: number, y: number) => number,
  time: number,
  palette: ThemePalette,
) {
  const bridgeDx = aiCx - userCx;
  const bridgeDy = aiCy - userCy;
  const bridgeLen = Math.sqrt(bridgeDx * bridgeDx + bridgeDy * bridgeDy) || 1;
  const bnx = bridgeDx / bridgeLen;
  const bny = bridgeDy / bridgeLen;

  const userDrop = userPrevEnergy - userEnergy;
  const aiDrop = aiPrevEnergy - aiEnergy;
  const BLOW_THRESH = 0.03;
  const BLOW_RADIUS = 140;

  const ORB_ZONE = 100;
  const REPEL_RADIUS = 50;
  const REPEL_STRENGTH = 0.25;
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i];
    const aInZone =
      (userActive && Math.hypot(a.x - userCx, a.y - userCy) < ORB_ZONE) ||
      (aiEnergy > 0.05 && Math.hypot(a.x - aiCx, a.y - aiCy) < ORB_ZONE);
    if (aInZone) continue;
    for (let j = i + 1; j < particles.length; j++) {
      const b = particles[j];
      const bInZone =
        (userActive && Math.hypot(b.x - userCx, b.y - userCy) < ORB_ZONE) ||
        (aiEnergy > 0.05 && Math.hypot(b.x - aiCx, b.y - aiCy) < ORB_ZONE);
      if (bInZone) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < REPEL_RADIUS) {
        const f = REPEL_STRENGTH * (1 - dist / REPEL_RADIUS);
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
  }

  for (const p of particles) {
    p.vx += noise(p.x * 0.005 + time * 0.2, p.y * 0.005 + time * 0.3) * 0.06;
    p.vy += noise(p.x * 0.005 + 100, p.y * 0.005 + time * 0.2) * 0.06;

    const attract = (cx: number, cy: number, energy: number, streamDirX: number, streamDirY: number) => {
      const dx = cx - p.x;
      const dy = cy - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 1;
      const force = (energy * 2.5) / (dist * 0.04);
      p.vx += (dx / dist) * force;
      p.vy += (dy / dist) * force;
      if (dist < 80) {
        const proximity = 1 - dist / 80;
        const stream = energy * 4.0 * proximity * proximity;
        p.vx += streamDirX * stream;
        p.vy += streamDirY * stream;
      }
    };

    const radialBlow = (cx: number, cy: number, drop: number, biasDirX: number, biasDirY: number) => {
      const dx = p.x - cx, dy = p.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < BLOW_RADIUS) {
        const proximity = 1 - dist / BLOW_RADIUS;
        const power = drop * 8.0 * proximity;
        const radX = dx / dist, radY = dy / dist;
        const pushX = radX * 0.4 + biasDirX * 0.6;
        const pushY = radY * 0.4 + biasDirY * 0.6;
        p.vx += pushX * power;
        p.vy += pushY * power;
      }
    };

    const aiSpeaking = aiEnergy > 0.05;
    const active = userActive || aiSpeaking;
    if (userActive) attract(userCx, userCy, userEnergy, bnx, bny);
    if (aiSpeaking) attract(aiCx, aiCy, aiEnergy, -bnx, -bny);

    if (userDrop > BLOW_THRESH) radialBlow(userCx, userCy, userDrop, bnx, bny);
    if (aiDrop > BLOW_THRESH) radialBlow(aiCx, aiCy, aiDrop, -bnx, -bny);

    if (!active) {
      const homeDist = Math.hypot(p.homeX - p.x, p.homeY - p.y);
      if (homeDist > 5) {
        const pull = Math.min(homeDist * 0.02, 1.0);
        p.vx += ((p.homeX - p.x) / homeDist) * pull;
        p.vy += ((p.homeY - p.y) / homeDist) * pull;
      }
      p.vx *= 0.92;
      p.vy *= 0.92;
    } else {
      p.vx *= 0.95;
      p.vy *= 0.95;
    }
    p.x += p.vx;
    p.y += p.vy;

    if (p.x < 0) { p.x = 0; p.vx *= -0.3; }
    if (p.x > w) { p.x = w; p.vx *= -0.3; }
    if (p.y < 0) { p.y = 0; p.vy *= -0.3; }
    if (p.y > h) { p.y = h; p.vy *= -0.3; }

    const nearUser = Math.hypot(p.x - userCx, p.y - userCy);
    const nearAi = Math.hypot(p.x - aiCx, p.y - aiCy);
    const nearestEnergy = nearUser < nearAi ? userEnergy : aiEnergy;
    const alphaBoost = nearestEnergy * 0.4;
    const alpha = Math.min((p.baseAlpha + alphaBoost) * palette.solidAlpha, 1);

    const isUserColor = p.color.r === USER_GREEN.r && p.color.g === USER_GREEN.g;
    const drawColor = isUserColor ? palette.particleUser : palette.particleNvidia;

    p.rotation += p.rotationSpeed * (1 + nearestEnergy * 3);

    const drawTri = (r: number, a: number) => {
      ctx.beginPath();
      for (let v = 0; v < 3; v++) {
        const angle = p.rotation + (v * Math.PI * 2) / 3 - Math.PI / 2;
        const tx = p.x + Math.cos(angle) * r;
        const ty = p.y + Math.sin(angle) * r;
        if (v === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
      }
      ctx.closePath();
      ctx.fillStyle = rgbStr(drawColor, a);
      ctx.fill();
    };

    drawTri(p.size * 2.2, Math.min(alpha * 0.2 * palette.glowAlpha, 1));
    drawTri(p.size, alpha);
  }
}

/* ------------------------------------------------------------------ */
/*  Drawing: bridge                                                    */
/* ------------------------------------------------------------------ */

export function drawBridge(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  userEnergy: number,
  aiEnergy: number,
  userSpeaking: boolean,
  aiSpeaking: boolean,
  time: number,
  noise: (x: number, y: number) => number,
  palette: ThemePalette,
) {
  const strength = Math.max(userEnergy, aiEnergy);
  if (strength < BRIDGE_MIN_ENERGY) return;

  const alpha = (strength - BRIDGE_MIN_ENERGY) / (1 - BRIDGE_MIN_ENERGY);
  const sa = palette.solidAlpha;
  const ga = palette.glowAlpha;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2 - 20 - alpha * 15;

  const cpX = midX + noise(time * 0.5, 0) * 10;
  const cpY = midY + noise(0, time * 0.5) * 8;

  const grad = ctx.createLinearGradient(x1, y1, x2, y2);
  grad.addColorStop(0, rgbStr(USER_GREEN, Math.min(alpha * 0.5 * sa, 1)));
  grad.addColorStop(0.5, rgbStr(NVIDIA_LIME, Math.min(alpha * 0.7 * sa, 1)));
  grad.addColorStop(1, rgbStr(NVIDIA_GREEN, Math.min(alpha * 0.5 * sa, 1)));

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cpX, cpY, x2, y2);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5 + alpha * 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cpX, cpY, x2, y2);
  ctx.strokeStyle = rgbStr(NVIDIA_LIME, Math.min(alpha * 0.12 * ga, 1));
  ctx.lineWidth = 6 + alpha * 10;
  ctx.stroke();

  const speed = 0.35;
  const flowDir = userSpeaking && !aiSpeaking ? 1
    : aiSpeaking && !userSpeaking ? -1
    : userSpeaking && aiSpeaking ? 0
    : 1;

  for (let i = 0; i < BRIDGE_PARTICLE_COUNT; i++) {
    const baseT = (i / BRIDGE_PARTICLE_COUNT + time * speed * flowDir) % 1;
    const t = baseT < 0 ? baseT + 1 : baseT;
    const inv = 1 - t;
    const px = inv * inv * x1 + 2 * inv * t * cpX + t * t * x2;
    const py = inv * inv * y1 + 2 * inv * t * cpY + t * t * y2;
    const pColor = lerpRgb(USER_GREEN, NVIDIA_GREEN, t);
    const pAlpha = Math.min(alpha * 0.8 * (1 - Math.abs(t - 0.5) * 2) * sa, 1);
    const rot = time * 2 + i * 1.2;
    const r = 2.5 + alpha * 2;

    const triPath = (radius: number, a: number) => {
      ctx.beginPath();
      for (let v = 0; v < 3; v++) {
        const angle = rot + (v * Math.PI * 2) / 3 - Math.PI / 2;
        const tx = px + Math.cos(angle) * radius;
        const ty = py + Math.sin(angle) * radius;
        if (v === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
      }
      ctx.closePath();
      ctx.fillStyle = rgbStr(pColor, a);
      ctx.fill();
    };

    triPath(r * 1.8, Math.min(pAlpha * 0.2 * ga, 1));
    triPath(r, pAlpha);
  }
}

/* ------------------------------------------------------------------ */
/*  Ring spawning helper                                               */
/* ------------------------------------------------------------------ */

export function trySpawnRing(
  orb: OrbState,
  cx: number,
  cy: number,
  maxR: number,
  color: RGB,
  rawEnergy: number,
  now: number,
) {
  const delta = rawEnergy - orb.prevEnergy;
  orb.prevEnergy = rawEnergy;
  if (
    delta > RING_SPAWN_THRESHOLD &&
    now - orb.lastRingTime > RING_SPAWN_COOLDOWN_MS &&
    orb.rings.length < MAX_RINGS_PER_ORB
  ) {
    orb.lastRingTime = now;
    const minR = maxR * 0.18;
    const currentR = minR + orb.smoothedEnergy * (maxR - minR);
    orb.rings.push({
      x: cx,
      y: cy,
      radius: currentR,
      maxRadius: RING_MAX_RADIUS + rawEnergy * 12,
      color,
      speed: RING_EXPAND_SPEED + rawEnergy * 0.4,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Energy smoothing                                                   */
/* ------------------------------------------------------------------ */

export function smoothEnergy(orb: OrbState, target: number) {
  orb.prevSmoothed = orb.smoothedEnergy;
  if (target > orb.smoothedEnergy) {
    orb.smoothedEnergy += (target - orb.smoothedEnergy) * 0.45;
  } else {
    orb.smoothedEnergy += (target - orb.smoothedEnergy) * 0.04;
  }
}

export function updateNoiseFloor(orb: OrbState, rawEnergy: number) {
  if (rawEnergy < orb.noiseFloor) {
    orb.noiseFloor += (rawEnergy - orb.noiseFloor) * 0.1;
  } else {
    orb.noiseFloor += (rawEnergy - orb.noiseFloor) * 0.0005;
  }
  if (rawEnergy > orb.recentPeak) {
    orb.recentPeak = rawEnergy;
  } else {
    orb.recentPeak *= 0.985;
  }
}
