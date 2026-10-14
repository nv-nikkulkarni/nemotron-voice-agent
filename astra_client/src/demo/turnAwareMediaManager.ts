// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import { DailyMediaManager } from "@pipecat-ai/websocket-transport";

/**
 * Allocates a stable player track ID until a browser-side interruption closes
 * the current bot turn.
 *
 * Pipecat's WavStreamPlayer remembers every interrupted track ID so that late
 * PCM for the cancelled turn is discarded. The WebSocket transport does not
 * provide a track ID, however, so every response otherwise uses "default".
 * Once "default" is interrupted, all later responses in that session are
 * silently discarded. Rotating the ID at the interruption boundary preserves
 * the late-frame guard without poisoning future bot turns.
 */
export class BotAudioTrackEpoch {
  private epoch = 0;

  get trackId(): string {
    return `bot-turn-${this.epoch}`;
  }

  advance(): string {
    this.epoch += 1;
    return this.trackId;
  }
}

// One browser tab owns one Pipecat client/media manager. Keep the active output
// epoch at module scope so the session lifecycle can rotate it before a new
// WebSocket begins, even though the transport does not expose its media manager.
const activeBotAudioTrack = new BotAudioTrackEpoch();

/** Allocate a track ID that has never been used by the previous session. */
export function advanceBotAudioSession(): string {
  return activeBotAudioTrack.advance();
}

const PREBUFFER_TARGET_MS = 240;
const PREBUFFER_MAX_WAIT_MS = 350;
const DEFAULT_PLAYER_SAMPLE_RATE = 22050;

interface PrebufferState {
  queue: { data: ArrayBuffer | Int16Array; trackId: string }[];
  queuedMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Estimated wall-clock time (ms) at which already-submitted audio finishes. */
  playEndsAt: number;
}

export class TurnAwareDailyMediaManager extends DailyMediaManager {
  private readonly botAudioTrack = activeBotAudioTrack;
  private prebuffer?: PrebufferState;
  private readonly prebufferSampleRate: number;

  constructor(...args: ConstructorParameters<typeof DailyMediaManager>) {
    super(...args);
    const playerSampleRate = args[6];
    this.prebufferSampleRate = typeof playerSampleRate === "number" && playerSampleRate > 0 ? playerSampleRate : DEFAULT_PLAYER_SAMPLE_RATE;
  }

  private get state(): PrebufferState {
    return (this.prebuffer ??= { queue: [], queuedMs: 0, timer: null, playEndsAt: 0 });
  }

  // The player starts on the first 128-sample block and tears its worklet down on
  // any underrun, so the first TTS chunks of a turn (which arrive at or below real
  // time) stutter. Hold the start of each utterance until a small cushion exists.
  private playerSampleRate(): number {
    return this.prebufferSampleRate ?? DEFAULT_PLAYER_SAMPLE_RATE;
  }

  private dropPrebuffer(): void {
    const state = this.state;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    state.queue = [];
    state.queuedMs = 0;
    state.playEndsAt = 0;
  }

  private flushPrebuffer(): void {
    const state = this.state;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    const pending = state.queue;
    state.queue = [];
    state.playEndsAt = performance.now() + state.queuedMs;
    state.queuedMs = 0;
    for (const { data, trackId } of pending) super.bufferBotAudio(data, trackId);
  }

  override async userStartedSpeaking(): Promise<unknown> {
    this.dropPrebuffer();
    try {
      return await super.userStartedSpeaking();
    } finally {
      // Even when there is no active stream (or interruption reporting fails),
      // the next response must never reuse a potentially interrupted ID.
      this.botAudioTrack.advance();
    }
  }

  override bufferBotAudio(data: ArrayBuffer | Int16Array): Int16Array | undefined {
    const trackId = this.botAudioTrack.trackId;
    const samples = data instanceof Int16Array ? data.length : data.byteLength / 2;
    const durationMs = (samples / this.playerSampleRate()) * 1000;
    const state = this.state;
    const now = performance.now();
    if (state.queue.length === 0 && now < state.playEndsAt) {
      state.playEndsAt += durationMs;
      return super.bufferBotAudio(data, trackId);
    }
    state.queue.push({ data, trackId });
    state.queuedMs += durationMs;
    if (state.queuedMs >= PREBUFFER_TARGET_MS) this.flushPrebuffer();
    else state.timer ??= setTimeout(() => this.flushPrebuffer(), PREBUFFER_MAX_WAIT_MS);
    return undefined;
  }
}
