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

export class TurnAwareDailyMediaManager extends DailyMediaManager {
  private readonly botAudioTrack = new BotAudioTrackEpoch();

  override async userStartedSpeaking(): Promise<unknown> {
    try {
      return await super.userStartedSpeaking();
    } finally {
      // Even when there is no active stream (or interruption reporting fails),
      // the next response must never reuse a potentially interrupted ID.
      this.botAudioTrack.advance();
    }
  }

  override bufferBotAudio(data: ArrayBuffer | Int16Array): Int16Array | undefined {
    return super.bufferBotAudio(data, this.botAudioTrack.trackId);
  }
}
