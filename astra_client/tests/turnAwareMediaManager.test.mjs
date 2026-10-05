// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { DailyMediaManager } from "@pipecat-ai/websocket-transport";

const compiledPath = process.env.TURN_AWARE_MEDIA_MANAGER_MODULE;
if (!compiledPath) throw new Error("TURN_AWARE_MEDIA_MANAGER_MODULE must point to compiled turnAwareMediaManager.js");

const { advanceBotAudioSession, BotAudioTrackEpoch, TurnAwareDailyMediaManager } = await import(
  pathToFileURL(compiledPath).href
);

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

test("allocates a fresh active track ID at every WebSocket session boundary", () => {
  const firstSession = advanceBotAudioSession();
  const secondSession = advanceBotAudioSession();

  assert.notEqual(firstSession, secondSession);
  assert.match(firstSession, /^bot-turn-\d+$/);
  assert.match(secondSession, /^bot-turn-\d+$/);
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
    manager.prebufferSampleRate = 22050;
    // 6000 samples (~272 ms) exceeds the start cushion, so audio is forwarded at once.
    const pcm = new Int16Array(6000);

    manager.bufferBotAudio(pcm);
    await manager.userStartedSpeaking();
    manager.bufferBotAudio(pcm);

    assert.equal(interrupts, 1);
    assert.deepEqual(bufferedTrackIds, ["bot-turn-0", "bot-turn-1"]);
  } finally {
    DailyMediaManager.prototype.userStartedSpeaking = originalInterrupt;
    DailyMediaManager.prototype.bufferBotAudio = originalBuffer;
  }
});

test("holds the start of an utterance until a cushion exists, then streams through", async () => {
  const originalBuffer = DailyMediaManager.prototype.bufferBotAudio;
  const delivered = [];
  DailyMediaManager.prototype.bufferBotAudio = (data, trackId) => {
    delivered.push(trackId);
    return data;
  };
  try {
    const manager = Object.create(TurnAwareDailyMediaManager.prototype);
    manager.botAudioTrack = new BotAudioTrackEpoch();
    manager.prebufferSampleRate = 22050;
    const chunk = new Int16Array(2205); // 100 ms

    manager.bufferBotAudio(chunk);
    manager.bufferBotAudio(chunk);
    assert.equal(delivered.length, 0, "first 200 ms is held");
    manager.bufferBotAudio(chunk);
    assert.equal(delivered.length, 3, "cushion reached, queued audio flushes in order");
    manager.bufferBotAudio(chunk);
    assert.equal(delivered.length, 4, "playing audio passes straight through");
  } finally {
    DailyMediaManager.prototype.bufferBotAudio = originalBuffer;
  }
});

test("flushes a short utterance after the wait cap and drops held audio on interruption", async () => {
  const originalBuffer = DailyMediaManager.prototype.bufferBotAudio;
  const originalInterrupt = DailyMediaManager.prototype.userStartedSpeaking;
  const delivered = [];
  DailyMediaManager.prototype.bufferBotAudio = (data, trackId) => { delivered.push(trackId); return data; };
  DailyMediaManager.prototype.userStartedSpeaking = async () => ({});
  try {
    const manager = Object.create(TurnAwareDailyMediaManager.prototype);
    manager.botAudioTrack = new BotAudioTrackEpoch();
    manager.prebufferSampleRate = 22050;
    manager.bufferBotAudio(new Int16Array(1000));
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(delivered.length, 1, "short audio is released by the timer");

    manager.bufferBotAudio(new Int16Array(100));
    await manager.userStartedSpeaking();
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(delivered.length, 1, "held audio from the interrupted turn is discarded");
  } finally {
    DailyMediaManager.prototype.bufferBotAudio = originalBuffer;
    DailyMediaManager.prototype.userStartedSpeaking = originalInterrupt;
  }
});
