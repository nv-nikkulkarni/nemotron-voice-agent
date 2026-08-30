// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Always-mounted, headless reporter that fires the session-capture upload when a
// session ends. It lives at the app shell level (NOT inside the live-conversation
// view), because that view unmounts the instant `isConnected` flips false on End —
// which tears down its RTVIEvent.Disconnected listener before it can run. Keeping
// this listener mounted for the app's lifetime guarantees the capture POST fires.
//
// It reads the transcript from usePipecatConversation() and the session id + consent
// from context via refs (so the Disconnected closure always sees the latest values,
// and still has the session id even after other handlers clear it). See
// demo/sessionCapture.ts for the upload + the app-pristine rationale.
import { useCallback, useEffect, useRef } from "react";
import { RTVIEvent } from "@pipecat-ai/client-js";
import {
  usePipecatConversation,
  useRTVIClientEvent,
  type ConversationMessage,
} from "@pipecat-ai/client-react";
import { useApp } from "../context/useApp";
import { useSessionLifecycle } from "../hooks/useSessionLifecycle";
import { flushSessionCapture, updateSessionCaptureSnapshot } from "./captureCoordinator";
import { buildTranscript, type CaptureTurn } from "./sessionCapture";
import { renderConversationMessageText } from "./transcriptRendering";


export function SessionCaptureReporter() {
  const { currentSessionId, storeConsent } = useApp();
  const { messages } = usePipecatConversation();
  const { phase } = useSessionLifecycle();

  const sidRef = useRef("");
  const consentRef = useRef(false);
  const msgsRef = useRef<ConversationMessage[]>([]);

  const syncSnapshot = useCallback((sid: string) => {
    if (!sid) return;
    const turns: CaptureTurn[] = msgsRef.current
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", text: renderConversationMessageText(m) }));
    updateSessionCaptureSnapshot(sid, consentRef.current, buildTranscript(turns));
  }, []);

  // Keep the last non-empty id and continuously refresh the shared snapshot.
  // The id survives other disconnect handlers clearing application state.
  useEffect(() => {
    if (!currentSessionId) return;
    sidRef.current = currentSessionId;
    syncSnapshot(currentSessionId);
  }, [currentSessionId, syncSnapshot]);
  useEffect(() => {
    consentRef.current = storeConsent;
    if (currentSessionId) syncSnapshot(currentSessionId);
  }, [currentSessionId, storeConsent, syncSnapshot]);
  useEffect(() => {
    msgsRef.current = messages;
    if (currentSessionId) syncSnapshot(currentSessionId);
  }, [currentSessionId, messages, syncSnapshot]);

  // Fresh transcript per session.
  useRTVIClientEvent(RTVIEvent.Connected, useCallback(() => {
    msgsRef.current = [];
    if (currentSessionId) syncSnapshot(currentSessionId);
  }, [currentSessionId, syncSnapshot]));

  const report = useCallback(() => {
    const sid = sidRef.current;
    if (!sid) return;
    syncSnapshot(sid);
    void flushSessionCapture(sid);
  }, [syncSnapshot]);

  // Fast path: fires the instant the transport confirms a clean disconnect.
  useRTVIClientEvent(RTVIEvent.Disconnected, report);

  // Browser-close fallback: start the same keepalive POST while the page is
  // still eligible to dispatch it. The coordinator deduplicates every trigger.
  useEffect(() => {
    window.addEventListener("pagehide", report);
    return () => window.removeEventListener("pagehide", report);
  }, [report]);

  // Reliable fallback: useSessionLifecycle's teardown gate always reaches
  // "ended" within a bounded time (its T_GLOBAL hard cap), even when the
  // transport's own disconnect() hangs and RTVIEvent.Disconnected never
  // fires (observed: WebSocketTransport awaits its media-manager teardown
  // before emitting Disconnected, and that teardown can stall) -- so capture
  // reporting must not depend solely on that event.
  useEffect(() => { if (phase === "ended") report(); }, [phase, report]);

  return null;
}
