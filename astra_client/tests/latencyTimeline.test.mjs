// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

const compiledPath = process.env.LATENCY_TIMELINE_MODULE;
if (!compiledPath) {
  throw new Error("LATENCY_TIMELINE_MODULE must point to compiled latencyTimeline.js");
}

const { buildAgentTimeline, selectFirstAudioLatency, suppressDuplicateLlmRows, timelineDomainMs } = await import(
  pathToFileURL(compiledPath).href
);

const row = (key, label, kind, valueMs, invocationId, outcome = "success") => ({
  id: `${key}:${invocationId}:1`,
  key,
  label,
  kind,
  valueMs,
  turnId: "turn-7",
  invocationId,
  attempt: 1,
  outcome,
});

test("builds critical and asynchronous waterfall lanes from observed completion offsets", () => {
  const rows = [
    row("frontend_tool_selection_ttft", "Frontend Talker — first tool-call token", "frontend", 100, "front"),
    row("frontend_tool_selection_processing_time", "Frontend Talker — total selection time", "frontend", 300, "front"),
    row("backend_llm_ttft", "Backend Thinker — first plan token", "backend", 150, "think"),
    row("backend_llm_processing_time", "Backend Thinker — total planning time", "backend", 500, "think"),
    row("backend_tool_call_latency", "Backend tool — get weather", "tool", 400, "tool"),
    row("frontend_final_response_ttft", "Frontend Talker — first answer token", "final", 100, "final"),
    row("frontend_final_response_processing_time", "Frontend Talker — total answer generation", "final", 300, "final"),
  ];
  const observed = {
    [rows[1].id]: 500,
    [rows[3].id]: 1100,
    [rows[4].id]: 1600,
    [rows[6].id]: 2000,
  };

  const timeline = buildAgentTimeline({ turnId: "turn-7", rows }, observed, 550);

  assert.equal(timeline.critical.length, 1);
  assert.deepEqual(
    [timeline.critical[0].startMs, timeline.critical[0].endMs, timeline.critical[0].ttftMs],
    [200, 500, 100],
  );
  assert.deepEqual(timeline.asynchronous.map((stage) => stage.kind), ["backend", "tool", "final"]);
  assert.deepEqual(timeline.asynchronous.map((stage) => stage.startMs), [600, 1200, 1700]);
  assert.equal(timeline.maxMs, 2000);
  assert.match(timeline.asynchronous[0].microcopy, /includes first plan token/i);
  assert.match(timeline.asynchronous[1].microcopy, /success/i);
});

test("falls back to an ordered view when browser observation offsets are unavailable", () => {
  const rows = [
    row("frontend_tool_selection_processing_time", "Frontend Talker — total selection time", "frontend", 300, "front"),
    row("backend_llm_processing_time", "Backend Thinker — total planning time", "backend", 500, "think"),
  ];

  const timeline = buildAgentTimeline({ turnId: "turn-7", rows }, {}, null);
  assert.equal(timeline.critical[0].startMs, 0);
  assert.equal(timeline.asynchronous[0].startMs, 300);
  assert.equal(timeline.maxMs, 800);
});

test("suppresses generic LLM rows only while structured agent metrics are present", () => {
  const rows = [
    { kind: "asr", label: "ASR", ms: 20 },
    { kind: "llm", label: "LLM", ms: 200 },
    { kind: "tts", label: "TTS", ms: 80 },
  ];

  assert.deepEqual(suppressDuplicateLlmRows(rows, true).map((item) => item.kind), ["asr", "tts"]);
  assert.deepEqual(suppressDuplicateLlmRows(rows, false), rows);
  assert.deepEqual(suppressDuplicateLlmRows(null, true), []);
});

test("rounds the visible domain up to a stable human-readable boundary", () => {
  assert.equal(timelineDomainMs(1), 100);
  assert.equal(timelineDomainMs(1730), 1800);
  assert.equal(timelineDomainMs(5300), 5500);
});

test("prefers server first-audio latency and falls back to browser-observed audio", () => {
  assert.equal(selectFirstAudioLatency(620, 690), 620);
  assert.equal(selectFirstAudioLatency(null, 690), 690);
  assert.equal(selectFirstAudioLatency(null, null), null);
});
