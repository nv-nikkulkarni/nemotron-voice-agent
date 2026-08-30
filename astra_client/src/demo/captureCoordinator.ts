// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

/** Shared, acknowledgement-aware session-capture reporting coordinator. */

export interface CaptureSnapshot {
  sessionId: string;
  consent: boolean;
  transcript: string;
}

export interface CaptureReportResult {
  acknowledged: boolean;
  attempts: number;
  status: number | null;
  outcome: "acknowledged" | "failed" | "not-ready";
}

interface CaptureRecord {
  snapshot?: CaptureSnapshot;
  attempts: number;
  acknowledged: boolean;
  status: number | null;
  inFlight?: Promise<CaptureReportResult>;
}

const MAX_ATTEMPTS = 2;
const ATTEMPT_TIMEOUT_MS = 650;
const RETRY_BACKOFF_MS = 100;
const records = new Map<string, CaptureRecord>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function recordFor(sessionId: string): CaptureRecord {
  let record = records.get(sessionId);
  if (!record) {
    record = { attempts: 0, acknowledged: false, status: null };
    records.set(sessionId, record);
  }
  return record;
}

/** Store the latest consent/transcript snapshot without starting a POST. */
export function updateSessionCaptureSnapshot(
  sessionId: string,
  consent: boolean,
  transcript: string,
): void {
  const sid = sessionId.trim();
  if (!sid) return;
  const record = recordFor(sid);
  if (record.acknowledged) return;
  record.snapshot = {
    sessionId: sid,
    consent,
    transcript: consent ? transcript : "",
  };
}

async function postOnce(snapshot: CaptureSnapshot): Promise<{ ok: boolean; status: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const response = await fetch("/api/session-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      signal: controller.signal,
      body: JSON.stringify({
        session_id: snapshot.sessionId,
        consent: snapshot.consent,
        transcript: snapshot.consent ? snapshot.transcript : "",
      }),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function runCapture(record: CaptureRecord): Promise<CaptureReportResult> {
  while (!record.acknowledged && record.attempts < MAX_ATTEMPTS) {
    const snapshot = record.snapshot;
    if (!snapshot) {
      return {
        acknowledged: false,
        attempts: record.attempts,
        status: record.status,
        outcome: "not-ready",
      };
    }
    record.attempts += 1;
    const response = await postOnce(snapshot);
    record.status = response.status;
    if (response.ok) {
      record.acknowledged = true;
      console.info("session-capture client outcome", {
        event: "session_capture_client",
        outcome: "acknowledged",
        sessionId: snapshot.sessionId,
        attempts: record.attempts,
        status: response.status,
      });
      break;
    }
    if (record.attempts < MAX_ATTEMPTS) await sleep(RETRY_BACKOFF_MS);
  }

  const result: CaptureReportResult = {
    acknowledged: record.acknowledged,
    attempts: record.attempts,
    status: record.status,
    outcome: record.acknowledged ? "acknowledged" : "failed",
  };
  if (!result.acknowledged) {
    console.warn("session-capture client outcome", {
      event: "session_capture_client",
      outcome: "failed",
      attempts: result.attempts,
      sessionId: record.snapshot?.sessionId ?? "",
      status: result.status,
    });
  }
  return result;
}

/** Await the one shared in-flight report for a session, starting it if ready. */
export function flushSessionCapture(sessionId: string): Promise<CaptureReportResult> {
  const sid = sessionId.trim();
  if (!sid) {
    return Promise.resolve({
      acknowledged: false,
      attempts: 0,
      status: null,
      outcome: "not-ready",
    });
  }
  const record = recordFor(sid);
  if (record.acknowledged) {
    return Promise.resolve({
      acknowledged: true,
      attempts: record.attempts,
      status: record.status,
      outcome: "acknowledged",
    });
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    return Promise.resolve({
      acknowledged: false,
      attempts: record.attempts,
      status: record.status,
      outcome: "failed",
    });
  }
  if (record.inFlight) return record.inFlight;

  const inFlight = runCapture(record).finally(() => {
    if (record.inFlight === inFlight) record.inFlight = undefined;
  });
  record.inFlight = inFlight;
  return inFlight;
}
