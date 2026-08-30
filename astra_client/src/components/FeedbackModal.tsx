// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Shown whenever a session ends: a simple thank-you. When a recording is
// available (the user opted to record) the same popup offers to download it.

export interface SessionSummary {
  example?: string;
  sessionId?: string;
  durationSec?: number;
  /** "timer" | "user" | "error" */
  endedReason?: string;
  errorMessage?: string;
  transportType?: string;
}

interface FeedbackModalProps {
  open: boolean;
  summary?: SessionSummary;
  /** Why the session ended — an involuntary drop shows a "connection lost" variant. */
  endedReason?: "user" | "timeout" | "error";
  /** A recorded session, if the user opted to record. */
  hasRecording?: boolean;
  onDownloadRecording?: () => void;
  /** Present for error/timeout ends: reconnect the same session in one click. */
  onReconnect?: () => void;
  onClose: () => void;
}

export function FeedbackModal({ open, summary, endedReason = "user", hasRecording, onDownloadRecording, onReconnect, onClose }: Readonly<FeedbackModalProps>) {
  if (!open) return null;

  const sessionId = summary?.sessionId?.trim();
  const copyId = () => { if (sessionId) void navigator.clipboard?.writeText(sessionId); };
  const dropped = endedReason !== "user"; // error / timeout

  return (
    <div className="demo-modal-backdrop" role="dialog" aria-modal="true" aria-label={dropped ? "Session interrupted" : "Session ended"}>
      <div className="demo-modal">
        <button className="demo-modal-close" onClick={onClose} aria-label="Close and return home" title="Close">×</button>
        <div className="demo-modal-done">
          <div className={`demo-modal-check ${dropped ? "demo-modal-check--warn" : ""}`}>{dropped ? "!" : "✓"}</div>
          <h2>{dropped ? "Connection lost" : "Thank you!"}</h2>
          <p className="demo-muted">
            {dropped
              ? "The session ended unexpectedly. You can reconnect and pick up where you left off."
              : "Thanks for trying the Nemotron Voice Agent."}
          </p>
          {sessionId && (
            <div className="session-id-block">
              <span className="session-id-label">Session ID — include this if you share feedback</span>
              <button className="session-id-chip" onClick={copyId} title="Copy session ID">
                <code>{sessionId}</code><span className="session-id-copy">copy</span>
              </button>
            </div>
          )}
          {hasRecording && (
            <button className="btn-secondary" onClick={onDownloadRecording}>⬇ Download recording (.webm)</button>
          )}
          {dropped && onReconnect
            ? <button className="btn-primary" onClick={onReconnect}>Reconnect</button>
            : <button className="btn-primary" onClick={onClose}>Start a new session</button>}
        </div>
      </div>
    </div>
  );
}
