// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// A transport-agnostic WebAudio output tap. On the WebSocket transport the bot
// audio is rendered straight through WebAudio (no MediaStreamTrack, no <audio>
// srcObject), so the only way to observe when a bot sample is actually AUDIBLE is
// to tap the AudioContext output. We insert a pass-through AnalyserNode in front
// of each AudioDestinationNode (installed once, guarded). Used to measure the
// client-side audio playout tail for the true-felt latency readout.

let installed = false;
let tapAnalyser: AnalyserNode | null = null;
let buf: Float32Array<ArrayBuffer> | null = null;

export function installMasterAudioTap(): void {
  if (installed || typeof AudioNode === "undefined") return;
  installed = true;
  const orig = AudioNode.prototype.connect;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (AudioNode.prototype as any).connect = function (dest: any, ...rest: any[]) {
    try {
      if (dest instanceof AudioDestinationNode) {
        const ctx = dest.context as AudioContext & { __tap?: AnalyserNode };
        if (!ctx.__tap) {
          const an = ctx.createAnalyser();
          an.fftSize = 512;
          (orig as any).call(an, ctx.destination);
          ctx.__tap = an;
          tapAnalyser = an;
          buf = new Float32Array(an.fftSize);
        }
        return (orig as any).call(this, ctx.__tap, ...rest);
      }
    } catch {
      /* fall through to the real connect */
    }
    return (orig as any).call(this, dest, ...rest);
  };
}

/** Current RMS of the master WebAudio output (0 if nothing is playing / not installed). */
export function outputRms(): number {
  if (!tapAnalyser || !buf) return 0;
  tapAnalyser.getFloatTimeDomainData(buf);
  let s = 0;
  for (const v of buf) s += v * v;
  return Math.sqrt(s / buf.length);
}
