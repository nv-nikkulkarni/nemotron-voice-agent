// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

/** Pure parsing and turn-correlation helpers for Frontend/Backend RTVI metrics. */

export type AgentStageMetricKind = "frontend" | "backend" | "tool" | "final";

export interface AgentStageMetricRow {
  id: string;
  key: string;
  label: string;
  kind: AgentStageMetricKind;
  valueMs: number;
  turnId: string;
  invocationId: string;
  attempt: number;
  outcome: string;
}

export interface AgentStageMetricSnapshot {
  turnId: string;
  rows: AgentStageMetricRow[];
}

type StageDefinition = {
  key: string;
  label: string;
  kind: AgentStageMetricKind;
};

const TTFB_STAGES: Record<string, StageDefinition> = {
  frontend_tool_selection_llm: {
    key: "frontend_tool_selection_ttft",
    label: "Frontend Talker — first tool-call token",
    kind: "frontend",
  },
  backend_thinker_llm: {
    key: "backend_llm_ttft",
    label: "Backend Thinker — first plan token",
    kind: "backend",
  },
  frontend_final_response_llm: {
    key: "frontend_final_response_ttft",
    label: "Frontend Talker — first answer token",
    kind: "final",
  },
};

const PROCESSING_STAGES: Record<string, StageDefinition> = {
  frontend_tool_selection_llm: {
    key: "frontend_tool_selection_processing_time",
    label: "Frontend Talker — total selection time",
    kind: "frontend",
  },
  backend_thinker_llm: {
    key: "backend_llm_processing_time",
    label: "Backend Thinker — total planning time",
    kind: "backend",
  },
  frontend_final_response_llm: {
    key: "frontend_final_response_processing_time",
    label: "Frontend Talker — total answer generation",
    kind: "final",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function metricsPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (value.type === "metrics" && isRecord(value.data)) return value.data;
  return value;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function attempt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function friendlyToolName(item: Record<string, unknown>, processor: string): string {
  const raw = text(item.tool_name) || processor.slice("backend_tool_call.".length) || "unknown";
  return raw.replaceAll("_", " ");
}

function rowsFromBucket(
  entries: unknown,
  definitions: Record<string, StageDefinition>,
  metric: "ttft" | "processing",
): AgentStageMetricRow[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((raw): AgentStageMetricRow[] => {
    if (!isRecord(raw) || typeof raw.value !== "number" || !Number.isFinite(raw.value) || raw.value < 0) return [];
    const processor = text(raw.processor);
    let definition = definitions[processor];
    if (!definition && metric === "processing" && processor.startsWith("backend_tool_call.")) {
      definition = {
        key: "backend_tool_call_latency",
        label: `Backend tool — ${friendlyToolName(raw, processor)}`,
        kind: "tool",
      };
    }
    if (!definition) return [];

    const turnId = text(raw.turn_id);
    const invocationId = text(raw.invocation_id);
    const stageAttempt = attempt(raw.attempt);
    const identity = invocationId || `${processor}:uncorrelated`;
    return [{
      id: `${definition.key}:${identity}:${stageAttempt}`,
      key: definition.key,
      label: stageAttempt > 1 ? `${definition.label} (attempt ${stageAttempt})` : definition.label,
      kind: definition.kind,
      valueMs: raw.value * 1000,
      turnId,
      invocationId,
      attempt: stageAttempt,
      outcome: text(raw.outcome),
    }];
  });
}

/** Extract only the seven Frontend/Backend stage metrics from an RTVI metrics event. */
export function parseAgentStageMetrics(value: unknown): AgentStageMetricRow[] {
  const payload = metricsPayload(value);
  if (!payload) return [];
  return [
    ...rowsFromBucket(payload.ttfb, TTFB_STAGES, "ttft"),
    ...rowsFromBucket(payload.processing, PROCESSING_STAGES, "processing"),
  ];
}

/** Merge stage events for the active turn while rejecting late events from an older turn. */
export function mergeAgentStageMetrics(
  current: AgentStageMetricSnapshot | null,
  updates: AgentStageMetricRow[],
): AgentStageMetricSnapshot | null {
  if (updates.length === 0) return current;
  const turnStart = updates.find((row) => row.key === "frontend_tool_selection_ttft");
  let snapshot = current;
  if (!snapshot || (turnStart?.turnId && turnStart.turnId !== snapshot.turnId)) {
    snapshot = { turnId: turnStart?.turnId || updates[0].turnId, rows: [] };
  }
  const rows = new Map(snapshot.rows.map((row) => [row.id, row]));
  for (const update of updates) {
    if (snapshot.turnId && update.turnId && update.turnId !== snapshot.turnId) continue;
    rows.set(update.id, update);
  }
  const order = [
    "frontend_tool_selection_ttft",
    "frontend_tool_selection_processing_time",
    "backend_llm_ttft",
    "backend_llm_processing_time",
    "backend_tool_call_latency",
    "frontend_final_response_ttft",
    "frontend_final_response_processing_time",
  ];
  const sorted = [...rows.values()].sort((left, right) => {
    const leftOrder = order.indexOf(left.key);
    const rightOrder = order.indexOf(right.key);
    return leftOrder - rightOrder || left.id.localeCompare(right.id);
  });
  return { turnId: snapshot.turnId, rows: sorted };
}
