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

/** Browser-observed stage ends can trail the server's first-audio mark by a few frames. */
const BLOCKING_TOLERANCE_MS = 50;

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
      label: row.label.replace(/^Frontend Talker — |^Backend Thinker(?: step \d+)? — |^Backend tool — /, ""),
      kind: row.kind,
      durationMs: row.valueMs,
      startMs,
      endMs,
      ttftMs: ttft?.valueMs ?? null,
      outcome: row.outcome,
      microcopy: stageMicrocopy(row.key, row.outcome),
    } satisfies AgentTimelineStage;
  });

  // A stage is on the critical path when first audio waited for it: the Talker's
  // selection always does, and a backend, tool, or final-answer stage does when it
  // finished before the first audio (e.g. the spoken answer needed the tool result).
  const blocking = (stage: AgentTimelineStage) =>
    stage.kind === "frontend" || (firstAudioMs != null && stage.endMs <= firstAudioMs + BLOCKING_TOLERANCE_MS);
  const critical = stages.filter(blocking);
  const asynchronous = stages.filter((stage) => !blocking(stage));
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

/** One named part of the measured interval, from the server `latency-breakdown` message. */
export interface LatencyContribution {
  key: string;
  label: string;
  owner: string;
  ownerKind: "service" | "setting" | "bot" | "pipeline" | string;
  offsetMs: number;
  durationMs: number;
}

export interface LatencyBreakdownMessage {
  totalMs: number | null;
  contributions: LatencyContribution[];
  vadStopMs: number | null;
  smartTurnStopMs: number | null;
  speechGateHoldMs: number | null;
}

export interface CriticalPathRow {
  key: string;
  label: string;
  detail: string;
  ms: number;
  tone: "setting" | "service" | "bot" | "pipeline" | "remainder";
}

export interface CriticalPath {
  rows: CriticalPathRow[];
  /** The headline the rows add up to. */
  totalMs: number;
  /** Sum of the named parts, before any remainder row. */
  attributedMs: number;
  /** Positive when the named parts exceed the headline (measured on different clocks). */
  overByMs: number;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Parse the structured fields of a `latency-breakdown` server message; null for an older server. */
export function parseLatencyBreakdownMessage(message: unknown): LatencyBreakdownMessage | null {
  if (!message || typeof message !== "object") return null;
  const raw = message as Record<string, unknown>;
  if (!Array.isArray(raw.contributions)) return null;
  const contributions = raw.contributions.flatMap((item): LatencyContribution[] => {
    if (!item || typeof item !== "object") return [];
    const part = item as Record<string, unknown>;
    const durationMs = num(part.duration_ms);
    if (durationMs == null || durationMs < 0 || typeof part.key !== "string") return [];
    return [{
      key: part.key,
      label: typeof part.label === "string" ? part.label : part.key,
      owner: typeof part.owner === "string" ? part.owner : "",
      ownerKind: typeof part.owner_kind === "string" ? part.owner_kind : "pipeline",
      offsetMs: num(part.offset_ms) ?? 0,
      durationMs,
    }];
  });
  const config = (raw.config && typeof raw.config === "object" ? raw.config : {}) as Record<string, unknown>;
  return {
    totalMs: num(raw.total_ms),
    contributions,
    vadStopMs: num(config.vad_stop_ms),
    smartTurnStopMs: num(config.smart_turn_stop_ms),
    speechGateHoldMs: num(raw.speech_gate_hold_ms),
  };
}

const TONES = new Set(["setting", "service", "bot", "pipeline"]);

function ownerName(owner: string): string {
  return owner.replace(/^config:\s*/, "").replace(/#\d+$/, "");
}

/** Friendly label and explanation for one pipecat contribution key. */
function describe(part: LatencyContribution, message: LatencyBreakdownMessage): { label: string; detail: string } {
  switch (part.key) {
    case "endpointing_wait":
      return {
        label: "Silence wait before the turn ends",
        detail: message.vadStopMs != null
          ? `The voice detector waits for ${message.vadStopMs} ms of silence (VAD stop_secs) before it decides you stopped.`
          : "The voice detector waits for a stretch of silence (VAD stop_secs) before it decides you stopped.",
      };
    case "transcription":
      return { label: "Speech recognition finalizes", detail: `ASR turns your last words into final text · ${ownerName(part.owner)}` };
    case "turn_detection":
      return {
        label: "Turn detection",
        detail: message.smartTurnStopMs != null
          ? `The smart-turn model confirms you are done (it can wait up to ${message.smartTurnStopMs} ms on an unfinished sentence).`
          : "The turn strategy confirms you are done speaking.",
      };
    case "first_request":
      return { label: "Session start", detail: "The connected handler and first request reaching the LLM." };
    case "llm_inference":
      return { label: "Talker LLM — first token", detail: `The frontend Talker reads the conversation and starts answering · ${ownerName(part.owner)}` };
    case "llm_tool_call":
      return { label: "Talker writes a tool call", detail: "The Talker decides to delegate and streams the call to the backend." };
    case "function_handler":
      return { label: "Backend and tools", detail: `The spoken answer waited for this work: the backend Thinker plans and runs grounded tools · ${ownerName(part.owner)}` };
    case "awaiting_speakable_text":
      return {
        label: "Waiting for speakable text",
        detail: message.speechGateHoldMs != null
          ? `Includes ${message.speechGateHoldMs} ms the speech gate held the reply until the full response arrived, so no tool-call text is ever spoken.`
          : "The reply is held until it is known to be safe to speak.",
      };
    case "turn_completion":
      return { label: "Turn completion check", detail: "The model's turn-completion marker is read before speaking." };
    case "waiting_for_user":
      return { label: "Waiting for you to finish", detail: "The model judged the sentence incomplete and waited for more." };
    case "sentence_aggregation":
      return { label: "TTS text aggregation", detail: "Text is collected into a full sentence before synthesis starts." };
    case "speech_synthesis":
      return { label: "Text-to-speech — first audio", detail: `Synthesis of the first audio chunk · ${ownerName(part.owner)}` };
    case "output_transport":
      return { label: "Output transport", detail: "The first audio frame leaves the server." };
    case "pipeline":
      return { label: "Pipeline handoffs", detail: "Time between stages that no single service owns (frame queues and scheduling)." };
    default:
      return { label: part.label.charAt(0).toUpperCase() + part.label.slice(1), detail: ownerName(part.owner) };
  }
}

/** Below this, a rounding gap between the named parts and the headline is not worth a row. */
const ROUNDING_MS = 2;

/**
 * Turn the server's contributions into ordered rows that add up to `headlineMs`.
 * Any gap becomes an explicit "Other / unattributed" row; it is never negative.
 */
export function buildCriticalPath(message: LatencyBreakdownMessage | null, headlineMs: number | null): CriticalPath | null {
  if (!message || message.contributions.length === 0) return null;
  const rows: CriticalPathRow[] = message.contributions.map((part) => ({
    key: part.key,
    ...describe(part, message),
    ms: Math.round(part.durationMs),
    tone: (TONES.has(part.ownerKind) ? part.ownerKind : "pipeline") as CriticalPathRow["tone"],
  }));
  const attributedMs = rows.reduce((sum, row) => sum + row.ms, 0);
  const totalMs = Math.round(headlineMs ?? message.totalMs ?? attributedMs);
  const gapMs = totalMs - attributedMs;
  if (gapMs > ROUNDING_MS) {
    rows.push({
      key: "unattributed",
      label: "Other / unattributed",
      detail: "Part of the measured time that no stage reported, for example a clock difference between the measurements.",
      ms: gapMs,
      tone: "remainder",
    });
  }
  return { rows, totalMs, attributedMs, overByMs: gapMs < -ROUNDING_MS ? -gapMs : 0 };
}
