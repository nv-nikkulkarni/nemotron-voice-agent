// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import type { AgentStageMetricKind, AgentStageMetricSnapshot } from "./frontendBackendStageMetrics";

export interface AgentTimelineStage {
  id: string;
  label: string;
  kind: AgentStageMetricKind;
  durationMs: number;
  startMs: number;
  endMs: number;
  ttftMs: number | null;
  outcome: string;
  microcopy: string;
}

export interface AgentTimeline {
  critical: AgentTimelineStage[];
  asynchronous: AgentTimelineStage[];
  maxMs: number;
}

const TOTAL_STAGE_KEYS = new Set([
  "frontend_tool_selection_processing_time",
  "backend_llm_processing_time",
  "backend_tool_call_latency",
  "frontend_final_response_processing_time",
]);

const TTFT_KEY_BY_TOTAL: Record<string, string> = {
  frontend_tool_selection_processing_time: "frontend_tool_selection_ttft",
  backend_llm_processing_time: "backend_llm_ttft",
  frontend_final_response_processing_time: "frontend_final_response_ttft",
};

function stageMicrocopy(key: string, outcome: string): string {
  if (key === "frontend_tool_selection_processing_time") {
    return "Decides whether to answer or delegate · total includes first tool-call token";
  }
  if (key === "backend_llm_processing_time") {
    return "Plans grounded work · total includes first plan token";
  }
  if (key === "backend_tool_call_latency") {
    return outcome ? `Grounded lookup · ${outcome}` : "Grounded live-data lookup";
  }
  return "Shapes the final answer · total includes first answer token";
}

/** Build a presentation-only waterfall from duration metrics and browser observation time. */
export function buildAgentTimeline(
  snapshot: AgentStageMetricSnapshot | null,
  observedAtMs: Readonly<Record<string, number>>,
  firstAudioMs: number | null,
): AgentTimeline {
  if (!snapshot) {
    return { critical: [], asynchronous: [], maxMs: Math.max(firstAudioMs ?? 0, 1) };
  }

  let fallbackCursor = 0;
  const stages = snapshot.rows.filter((row) => TOTAL_STAGE_KEYS.has(row.key)).map((row) => {
    const ttftKey = TTFT_KEY_BY_TOTAL[row.key];
    const ttft = ttftKey
      ? snapshot.rows.find((candidate) =>
          candidate.key === ttftKey
          && candidate.invocationId === row.invocationId
          && candidate.attempt === row.attempt)
      : undefined;
    const observedEnd = observedAtMs[row.id];
    const startMs = observedEnd == null ? fallbackCursor : Math.max(0, observedEnd - row.valueMs);
    const endMs = startMs + row.valueMs;
    fallbackCursor = Math.max(fallbackCursor, endMs);
    return {
      id: row.id,
      label: row.label.replace(/^Frontend Talker — |^Backend Thinker — |^Backend tool — /, ""),
      kind: row.kind,
      durationMs: row.valueMs,
      startMs,
      endMs,
      ttftMs: ttft?.valueMs ?? null,
      outcome: row.outcome,
      microcopy: stageMicrocopy(row.key, row.outcome),
    } satisfies AgentTimelineStage;
  });

  const critical = stages.filter((stage) => stage.kind === "frontend");
  const asynchronous = stages.filter((stage) => stage.kind !== "frontend");
  const latestEnd = stages.reduce((maximum, stage) => Math.max(maximum, stage.endMs), 0);
  return { critical, asynchronous, maxMs: Math.max(firstAudioMs ?? 0, latestEnd, 1) };
}

export function timelineDomainMs(valueMs: number): number {
  const safeValue = Math.max(1, valueMs);
  const magnitude = 10 ** Math.floor(Math.log10(safeValue));
  const step = magnitude / (safeValue / magnitude < 2 ? 5 : 2);
  return Math.max(100, Math.ceil(safeValue / step) * step);
}

export function suppressDuplicateLlmRows<T extends { kind: string }>(
  rows: T[] | null,
  hasStructured: boolean,
): T[] {
  return (rows ?? []).filter((row) => !(hasStructured && row.kind === "llm"));
}

export function selectFirstAudioLatency(serverMs: number | null, clientMs: number | null): number | null {
  return serverMs ?? clientMs;
}
