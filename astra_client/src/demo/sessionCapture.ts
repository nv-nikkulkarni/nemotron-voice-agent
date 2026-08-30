// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Client-side session capture upload.
//
// At session end the UI already holds the full user/assistant transcript it just
// rendered, so the client POSTs { session_id, consent, transcript } to the app's
// same-origin `/api/session-capture` endpoint. The app writes a `<sid>.consent`
// marker (+ `<sid>.transcript.txt` when consented) into the shared capture dir the
// logkeeper sidecar reads; the logkeeper then bundles/uploads a session ONLY when
// consent is true, and discards its audio otherwise. Using `/api/*` means it works
// everywhere the app is reachable — including through the NVCF gateway, which routes
// only the app's port (a separate receiver port would be unreachable there).
//
// Reporting is bounded and acknowledgement-aware. A failed capture never blocks
// teardown indefinitely, but the teardown report records whether the server
// actually acknowledged the request.

import {
  flushSessionCapture,
  updateSessionCaptureSnapshot,
  type CaptureReportResult,
} from "./captureCoordinator";

export interface CaptureTurn {
  role: "user" | "assistant";
  text: string;
}

/** Render the just-shown conversation into a plain-text transcript. */
export function buildTranscript(turns: CaptureTurn[]): string {
  return turns
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text.trim()}`)
    .filter((line) => line.length > (line.startsWith("User") ? 6 : 11)) // drop empty turns
    .join("\n");
}

/**
 * Report a finished session to the capture receiver. Always sends the consent
 * flag (so the logkeeper knows to discard non-consented audio); only sends the
 * transcript when the user consented. Resolves with the server acknowledgement
 * result and never throws.
 */
export async function postSessionCapture(
  sessionId: string,
  consent: boolean,
  transcript: string,
): Promise<CaptureReportResult> {
  updateSessionCaptureSnapshot(sessionId, consent, transcript);
  return flushSessionCapture(sessionId);
}
