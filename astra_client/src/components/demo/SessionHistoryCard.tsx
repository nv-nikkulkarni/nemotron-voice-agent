// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// "Sessions" card — the visitor's recent demo sessions this visit.

import { useSessionHistory, type SessionRecord } from "../../hooks/useSessionHistory";

function fmtDuration(sec?: number): string {
  if (!sec || sec <= 0) return "—";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function reasonLabel(reason?: string): string {
  if (reason === "timer") return "time up";
  if (reason === "error") return "dropped";
  return "ended";
}

function Row({ record }: Readonly<{ record: SessionRecord }>) {
  return (
    <li className="session-history__row">
      <div className="session-history__main">
        <span className="session-history__title">{record.storyTitle ?? record.example ?? "Session"}</span>
        <span className="session-history__meta">
          {fmtDuration(record.durationSec)} · {reasonLabel(record.endedReason)}
        </span>
      </div>
      <code className="session-history__id" title={record.sessionId}>
        {record.sessionId ? record.sessionId.slice(0, 8) : "—"}
      </code>
    </li>
  );
}

export function SessionHistoryCard() {
  const { history, clear } = useSessionHistory();
  if (!history.length) return null;

  return (
    <div className="card sidebar-card">
      <div className="session-history__head">
        <p className="text-xs text-secondary mb-0">SESSIONS</p>
        <button type="button" className="session-history__clear" onClick={clear}>Clear</button>
      </div>
      <ul className="session-history">
        {history.map((record) => (
          <Row key={`${record.sessionId}-${record.endedAt}`} record={record} />
        ))}
      </ul>
    </div>
  );
}
