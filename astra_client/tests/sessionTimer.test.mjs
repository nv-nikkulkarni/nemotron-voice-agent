// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

const compiledPath = process.env.SESSION_TIMER_MODULE;
if (!compiledPath) throw new Error("SESSION_TIMER_MODULE must point to compiled sessionTimer.js");

const {
  DEFAULT_SESSION_SECONDS,
  formatSessionTime,
  normalizeSessionSeconds,
  remainingSessionSeconds,
  sessionTimerTone,
} = await import(pathToFileURL(compiledPath).href);

test("defaults invalid durations to ten minutes and accepts positive overrides", () => {
  assert.equal(DEFAULT_SESSION_SECONDS, 600);
  assert.equal(normalizeSessionSeconds(undefined), 600);
  assert.equal(normalizeSessionSeconds(0), 600);
  assert.equal(normalizeSessionSeconds("invalid"), 600);
  assert.equal(normalizeSessionSeconds(12.9), 12);
});

test("uses an absolute deadline so delayed ticks do not extend a session", () => {
  assert.equal(remainingSessionSeconds(601_000, 1_000), 600);
  assert.equal(remainingSessionSeconds(601_000, 600_001), 1);
  assert.equal(remainingSessionSeconds(601_000, 601_000), 0);
  assert.equal(remainingSessionSeconds(601_000, 999_999), 0);
});

test("formats the countdown and applies warning thresholds", () => {
  assert.equal(formatSessionTime(600), "10:00");
  assert.equal(formatSessionTime(61), "01:01");
  assert.equal(formatSessionTime(0), "00:00");
  assert.equal(sessionTimerTone(61), "");
  assert.equal(sessionTimerTone(60), "low");
  assert.equal(sessionTimerTone(15), "critical");
});
