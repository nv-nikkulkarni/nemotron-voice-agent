// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Collapsible console on the live conversation page. It lists the main events of
// the session (tool calls, barge-in, turns) and keeps only the latest N entries.

import { useCallback, useEffect, useRef, useState } from "react";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { useRTVIClientEvent } from "@pipecat-ai/client-react";
import { appendEvent, DEFAULT_EVENT_LIMIT, describeToolCall, EVENT_LIMITS, trimEvents, type EventKind, type LogEvent } from "../../demo/eventLog";
import { useStickToBottom } from "../../hooks/useStickToBottom";

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false });
}

export function EventLog() {
  const [open, setOpen] = useState(true);
  const [limit, setLimit] = useState<number>(DEFAULT_EVENT_LIMIT);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const nextId = useRef(1);
  const limitRef = useRef(limit);
  useEffect(() => { limitRef.current = limit; }, [limit]);
  const botSpeaking = useRef(false);

  const push = useCallback((kind: EventKind, text: string) => {
    const id = nextId.current++;
    setEvents((prev) => appendEvent(prev, { at: Date.now(), kind, text }, limitRef.current, id));
  }, []);
  const changeLimit = (value: number) => {
    limitRef.current = value;
    setLimit(value);
    setEvents((prev) => trimEvents(prev, value));
  };

  useRTVIClientEvent(RTVIEvent.Connected, useCallback(() => push("session", "Session connected"), [push]));
  useRTVIClientEvent(RTVIEvent.Disconnected, useCallback(() => { botSpeaking.current = false; push("session", "Session ended"); }, [push]));
  useRTVIClientEvent(RTVIEvent.BotStartedSpeaking, useCallback(() => { botSpeaking.current = true; push("bot", "Assistant started speaking"); }, [push]));
  useRTVIClientEvent(RTVIEvent.BotStoppedSpeaking, useCallback(() => { botSpeaking.current = false; push("bot", "Assistant finished speaking"); }, [push]));
  useRTVIClientEvent(RTVIEvent.UserStartedSpeaking, useCallback(() => {
    if (botSpeaking.current) { botSpeaking.current = false; push("barge-in", "Barge-in detected — assistant interrupted"); }
    else push("user", "User started speaking");
  }, [push]));
  useRTVIClientEvent(RTVIEvent.LLMFunctionCallInProgress, useCallback((data: { function_name?: string; arguments?: Record<string, unknown> }) => {
    push("tool", describeToolCall(data.function_name, data.arguments));
  }, [push]));
  useRTVIClientEvent(RTVIEvent.ServerMessage, useCallback((message: unknown) => {
    if (!message || typeof message !== "object") return;
    const data = message as Record<string, unknown>;
    if (data.type === "tool-call" && typeof data.tool === "string") push("tool", describeToolCall(data.tool));
    else if (data.type === "user-turn-finalized") push("user", "User turn finalized");
    else if (data.type === "agent-task-update" && (data.status === "done" || data.status === "failed") && typeof data.agent === "string") {
      push("agent", `${titleCaseAgent(data.agent)} ${data.status === "done" ? "finished" : "failed"}`);
    }
  }, [push]));

  const anchorRef = useStickToBottom(events.length);

  return <aside className={`event-log${open ? "" : " event-log--collapsed"}`} aria-label="Event log" data-tour="event-log">
    <button type="button" className="event-log__toggle" aria-expanded={open} aria-controls="event-log-body" onClick={() => setOpen((value) => !value)}>
      <span aria-hidden="true">{open ? "›" : "‹"}</span>
      <span className="event-log__title">Event log</span>
      {!open && events.length > 0 && <span className="event-log__count">{events.length}</span>}
    </button>
    {open && <div id="event-log-body" className="event-log__body">
      <div className="event-log__bar">
        <label>Keep last
          <select value={limit} onChange={(event) => changeLimit(Number(event.target.value))} aria-label="Maximum events kept">
            {EVENT_LIMITS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setEvents([])} disabled={events.length === 0}>Clear</button>
      </div>
      <div className="event-log__list" role="log" aria-live="off">
        {events.length === 0 && <p className="event-log__empty">Tool calls, barge-ins, and turns appear here.</p>}
        {events.map((entry) => <p key={entry.id} className={`event-log__row event-log__row--${entry.kind}`}>
          <time>{clock(entry.at)}</time><span>{entry.text}</span>
        </p>)}
        <div ref={anchorRef} />
      </div>
    </div>}
  </aside>;
}

function titleCaseAgent(agent: string): string {
  const label = agent.replace(/[_-]+/g, " ").trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}
