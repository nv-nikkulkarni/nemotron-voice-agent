// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Pure helpers for the live event console: formatting tool calls into readable
// lines, bounding the log, and collapsing duplicate reports of the same call.

export type EventKind = "session" | "user" | "bot" | "tool" | "barge-in" | "agent";

export interface LogEvent {
  id: number;
  at: number;
  kind: EventKind;
  text: string;
}

export const EVENT_LIMITS = [25, 50, 100] as const;
export const DEFAULT_EVENT_LIMIT = 50;
const DUPLICATE_TOOL_WINDOW_MS = 2000;

const SUBJECT_KEYS = ["city", "location", "symbol", "ticker", "company", "query", "from_currency", "currency", "timezone"];

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").trim();
}

function subjectOf(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  for (const key of SUBJECT_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 48);
  }
  const first = Object.values(args).find((value) => typeof value === "string" && value.trim());
  return typeof first === "string" ? first.trim().slice(0, 48) : "";
}

/** "get_weather" + {city: "Tokyo"} -> "Weather tool called for Tokyo". */
export function describeToolCall(name: string | undefined, args?: Record<string, unknown>): string {
  const raw = (name ?? "").trim();
  if (!raw) return "Tool called";
  const subject = subjectOf(args);
  const base = titleCase(raw.replace(/^(get|fetch|lookup|calculate|convert)_/, ""));
  const label = base.charAt(0).toUpperCase() + base.slice(1);
  return subject ? `${label} tool called for ${subject}` : `${label} tool called`;
}

/** Append an event, dropping the oldest beyond `limit` and duplicate tool reports. */
export function appendEvent(
  events: readonly LogEvent[],
  event: Omit<LogEvent, "id">,
  limit: number,
  nextId: number,
): LogEvent[] {
  const last = events[events.length - 1];
  if (
    last && event.kind === "tool" && last.kind === "tool" &&
    event.at - last.at < DUPLICATE_TOOL_WINDOW_MS &&
    (last.text === event.text || last.text.split(" tool called")[0].toLowerCase() === event.text.split(" tool called")[0].toLowerCase())
  ) {
    // Prefer the richer line (the one naming a subject).
    return event.text.length > last.text.length ? [...events.slice(0, -1), { ...last, text: event.text }] : [...events];
  }
  return [...events, { ...event, id: nextId }].slice(-Math.max(1, limit));
}

export function trimEvents(events: readonly LogEvent[], limit: number): LogEvent[] {
  return events.slice(-Math.max(1, limit));
}
