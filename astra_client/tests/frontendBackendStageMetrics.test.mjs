// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

const compiledPath = process.env.FRONTEND_BACKEND_STAGE_METRICS_MODULE;
if (!compiledPath) {
  throw new Error("FRONTEND_BACKEND_STAGE_METRICS_MODULE must point to compiled frontendBackendStageMetrics.js");
}

const { mergeAgentStageMetrics, parseAgentStageMetrics } = await import(pathToFileURL(compiledPath).href);

const metric = (processor, value, turnId, invocationId, extras = {}) => ({
  processor,
  value,
  turn_id: turnId,
  invocation_id: invocationId,
  attempt: 1,
  ...extras,
});

test("extracts the seven granular frontend/backend metrics and converts seconds to milliseconds", () => {
  const rows = parseAgentStageMetrics({
    type: "metrics",
    data: {
      ttfb: [
        metric("frontend_tool_selection_llm", 0.1, "turn-1", "front-1"),
        metric("backend_thinker_llm", 0.2, "turn-1", "thinker-1"),
        metric("frontend_final_response_llm", 0.3, "turn-1", "final-1"),
      ],
      processing: [
        metric("frontend_tool_selection_llm", 0.4, "turn-1", "front-1", { outcome: "success" }),
        metric("backend_thinker_llm", 0.5, "turn-1", "thinker-1", { outcome: "success" }),
        metric("backend_tool_call.web_search", 0.6, "turn-1", "tool-1", {
          outcome: "success",
          tool_name: "web_search",
        }),
        metric("frontend_final_response_llm", 0.7, "turn-1", "final-1", { outcome: "success" }),
      ],
    },
  });

  assert.deepEqual(rows.map((row) => row.key), [
    "frontend_tool_selection_ttft",
    "backend_llm_ttft",
    "frontend_final_response_ttft",
    "frontend_tool_selection_processing_time",
    "backend_llm_processing_time",
    "backend_tool_call_latency",
    "frontend_final_response_processing_time",
  ]);
  assert.deepEqual(rows.map((row) => row.valueMs), [100, 200, 300, 400, 500, 600, 700]);
  assert.match(rows[5].label, /web search/i);
});

test("exposes second and third Thinker planning rounds as correlated backend rows", () => {
  const rows = parseAgentStageMetrics({
    ttfb: [
      metric("backend_thinker_step2_llm", 0.12, "turn-1", "thinker-step2-1"),
      metric("backend_thinker_step3_llm", 0.14, "turn-1", "thinker-step3-1"),
    ],
    processing: [
      metric("backend_thinker_step2_llm", 0.42, "turn-1", "thinker-step2-1"),
      metric("backend_thinker_step3_llm", 0.51, "turn-1", "thinker-step3-1"),
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.label),
    [
      "Backend Thinker step 2 — first plan token",
      "Backend Thinker step 3 — first plan token",
      "Backend Thinker step 2 — total planning time",
      "Backend Thinker step 3 — total planning time",
    ],
  );
});

test("ignores unrelated standard pipeline metrics", () => {
  const rows = parseAgentStageMetrics({
    ttfb: [metric("NvidiaRivaSTTService#0", 0.1, "", "")],
    processing: [metric("NvidiaTTSService#0", 0.2, "", "")],
  });
  assert.deepEqual(rows, []);
});

test("keeps multiple tool invocations and updates the matching stage event", () => {
  const first = parseAgentStageMetrics({
    processing: [
      metric("backend_tool_call.get_weather", 0.4, "turn-1", "tool-1", { tool_name: "get_weather" }),
      metric("backend_tool_call.get_stock_price", 0.5, "turn-1", "tool-2", { tool_name: "get_stock_price" }),
    ],
  });
  let snapshot = mergeAgentStageMetrics(null, first);
  assert.equal(snapshot.rows.length, 2);

  const update = parseAgentStageMetrics({
    processing: [
      metric("backend_tool_call.get_weather", 0.45, "turn-1", "tool-1", { tool_name: "get_weather" }),
    ],
  });
  snapshot = mergeAgentStageMetrics(snapshot, update);
  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.rows.find((row) => row.invocationId === "tool-1").valueMs, 450);
});

test("starts a fresh correlated turn and rejects a late event from the prior turn", () => {
  const oldRows = parseAgentStageMetrics({
    ttfb: [metric("frontend_tool_selection_llm", 0.1, "turn-1", "front-1")],
  });
  let snapshot = mergeAgentStageMetrics(null, oldRows);

  const newRows = parseAgentStageMetrics({
    ttfb: [metric("frontend_tool_selection_llm", 0.2, "turn-2", "front-2")],
  });
  snapshot = mergeAgentStageMetrics(snapshot, newRows);
  assert.equal(snapshot.turnId, "turn-2");
  assert.equal(snapshot.rows.length, 1);

  const lateRows = parseAgentStageMetrics({
    processing: [metric("frontend_final_response_llm", 0.9, "turn-1", "final-1")],
  });
  snapshot = mergeAgentStageMetrics(snapshot, lateRows);
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].turnId, "turn-2");
});
