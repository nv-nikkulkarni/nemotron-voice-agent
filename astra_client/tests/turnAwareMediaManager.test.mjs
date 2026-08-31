// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { DailyMediaManager } from "@pipecat-ai/websocket-transport";

const compiledPath = process.env.TURN_AWARE_MEDIA_MANAGER_MODULE;
if (!compiledPath) throw new Error("TURN_AWARE_MEDIA_MANAGER_MODULE must point to compiled turnAwareMediaManager.js");

const { BotAudioTrackEpoch, TurnAwareDailyMediaManager } = await import(pathToFileURL(compiledPath).href);

test("keeps one track ID within a bot turn", () => {
  const tracks = new BotAudioTrackEpoch();

  assert.equal(tracks.trackId, "bot-turn-0");
  assert.equal(tracks.trackId, "bot-turn-0");
});

test("allocates a fresh track ID after every interruption", () => {
  const tracks = new BotAudioTrackEpoch();

  assert.equal(tracks.advance(), "bot-turn-1");
  assert.equal(tracks.advance(), "bot-turn-2");
  assert.equal(tracks.trackId, "bot-turn-2");
});

test("routes audio through a fresh player track after interruption", async () => {
  const originalInterrupt = DailyMediaManager.prototype.userStartedSpeaking;
  const originalBuffer = DailyMediaManager.prototype.bufferBotAudio;
  const bufferedTrackIds = [];
  let interrupts = 0;

  DailyMediaManager.prototype.userStartedSpeaking = async () => {
    interrupts += 1;
    return { trackId: "bot-turn-0" };
  };
  DailyMediaManager.prototype.bufferBotAudio = (data, trackId) => {
    bufferedTrackIds.push(trackId);
    return data instanceof Int16Array ? data : new Int16Array(data);
  };

  try {
    // Avoid the browser-only Daily constructor while exercising the subclass
    // boundary against the public base methods.
    const manager = Object.create(TurnAwareDailyMediaManager.prototype);
    manager.botAudioTrack = new BotAudioTrackEpoch();
    const pcm = new Int16Array([1, 2]);

    assert.strictEqual(manager.bufferBotAudio(pcm), pcm);
    await manager.userStartedSpeaking();
    assert.strictEqual(manager.bufferBotAudio(pcm), pcm);

    assert.equal(interrupts, 1);
    assert.deepEqual(bufferedTrackIds, ["bot-turn-0", "bot-turn-1"]);
  } finally {
    DailyMediaManager.prototype.userStartedSpeaking = originalInterrupt;
    DailyMediaManager.prototype.bufferBotAudio = originalBuffer;
  }
});
