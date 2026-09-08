// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Single source of truth for the session lifecycle: an interruptible, idempotent
// state machine around start/stop.
//
//   idle → starting → live → stopping → ended → (idle | starting)
//
// End funnels through one AWAITABLE teardown gate that verifies a clean close
// (WS terminal state, mic released, bot audio flushed, recorder finalized) under
// a hard time cap, then a "buffering" overlay is shown ONLY if teardown is slow.
// A reconnect during `stopping` AWAITS the in-flight teardown before connecting,
// so rapid End↔Start toggling never overlaps sockets/sessions. An involuntary
// transport drop routes through the same gate with reason "error".

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePipecatClient, usePipecatClientTransportState } from "@pipecat-ai/client-react";
import { useVoiceSession, type StartOptions } from "./useVoiceSession";
import { useSessionRecorder } from "./useSessionRecorder";
import { useApp } from "../context/useApp";
import { demoConfig } from "../config";
import { flushSessionCapture } from "../demo/captureCoordinator";

export type SessionPhase = "idle" | "starting" | "live" | "stopping" | "ended";
export type EndedReason = "user" | "timeout" | "error";

export interface TeardownReport {
  reason: EndedReason;
  forced: boolean;
  wsMs: number | null;
  tracksStopped: number;
  audioFlushed: boolean;
  recorderFinalized: boolean;
  captureFlushed: boolean;
}

interface LifecycleClient {
  disconnect?: () => Promise<void> | void;
  enableMic?: (on: boolean) => void;
  tracks?: () => { local?: { audio?: MediaStreamTrack | null } } | undefined;
  state?: string;
}

interface SessionLifecycleValue {
  phase: SessionPhase;
  endedReason: EndedReason | null;
  overlayVisible: boolean;
  connectionError: string;
  clearError: () => void;
  beginSession: (opts?: StartOptions) => Promise<void>;
  endSession: (reason?: EndedReason) => Promise<void>;
  dismiss: () => void;
  isRecording: boolean;
  recording: Blob | null;
  downloadRecording: () => void;
  clearRecording: () => void;
  lastTeardown: TeardownReport | null;
}

const Ctx = createContext<SessionLifecycleValue | null>(null);

const CONNECTED = new Set(["connected", "ready"]);
const STARTING = new Set(["authenticating", "authenticated", "connecting", "initializing", "initialized"]);
const TERMINAL = new Set(["disconnected", "error"]);

const T_TRANSPORT = 1500; // wait for WS terminal state
const T_RECORDER = 1200;  // wait for the recording blob
const T_CAPTURE = 1500;   // wait for a 2xx capture acknowledgement
const T_GLOBAL = 4000;    // hard cap → force close
const DEFAULT_GRACE_MS = 1500; // deliberate buffering window before the thank-you modal
const CONNECT_TIMEOUT_MS = 25000; // recover if a connect fails/hangs instead of sticking on "Starting"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(p).then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}

export function SessionLifecycleProvider({ children }: Readonly<{ children: ReactNode }>) {
  const client = usePipecatClient() as unknown as LifecycleClient | undefined;
  const transportState = usePipecatClientTransportState() as unknown as string;
  const { connect: rawConnect, connectionError, clearError } = useVoiceSession();
  const recorder = useSessionRecorder();
  const app = useApp();
  const enabled = demoConfig.gracefulTeardown !== false;
  const graceMs = demoConfig.teardownGraceMs ?? DEFAULT_GRACE_MS;

  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [endedReason, setEndedReason] = useState<EndedReason | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [lastTeardown, setLastTeardown] = useState<TeardownReport | null>(null);

  const teardownRef = useRef<Promise<TeardownReport> | null>(null);
  const connectRef = useRef<Promise<void> | null>(null);
  const reconnectPendingRef = useRef(false);
  const wasLiveRef = useRef(false);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const recorderRef = useRef(recorder); recorderRef.current = recorder;
  const endSessionRef = useRef<(r: EndedReason) => Promise<void>>(async () => {});

  const waitForTerminal = useCallback(async (ms: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = client?.state ?? "";
      if (TERMINAL.has(s)) return true;
      await sleep(50);
    }
    return TERMINAL.has(client?.state ?? "");
  }, [client]);

  const gracefulTeardown = useCallback(async (reason: EndedReason): Promise<TeardownReport> => {
    const t0 = Date.now();
    const captureSid = app.currentSessionId;
    const report: TeardownReport = {
      reason, forced: false, wsMs: null, tracksStopped: 0,
      audioFlushed: false, recorderFinalized: false, captureFlushed: false,
    };
    const micTracks: MediaStreamTrack[] = [];
    try { const a = client?.tracks?.()?.local?.audio; if (a) micTracks.push(a); } catch { /* ignore */ }

    const run = (async () => {
      // 1. begin the WS close
      try { await withTimeout(Promise.resolve(client?.disconnect?.()), T_TRANSPORT); }
      catch { report.forced = true; }
      // 2. wait for the transport to reach a terminal (closed) state
      if (!(await waitForTerminal(T_TRANSPORT))) report.forced = true;
      report.wsMs = Date.now() - t0;
      // 3. VERIFY the mic was released (the transport's disconnect stops its own
      //    tracks + re-acquires on reconnect, so we must NOT stop/disable them
      //    here or the next connect breaks — we only observe, and force-stop only
      //    in the timeout path below).
      report.tracksStopped = micTracks.filter((t) => t.readyState === "ended").length;
      // 4. flush any bot audio still playing (pause only; leave srcObject so the
      //    next session can re-attach + autoplay).
      try {
        for (const el of Array.from(document.querySelectorAll("audio"))) el.pause();
        report.audioFlushed = true;
      } catch { /* ignore */ }
      // 5. finalize the recording (so the download is ready before the modal offers it)
      const r = recorderRef.current;
      if (r.isRecording) {
        try { await withTimeout(r.stopAndFinalize(), T_RECORDER); report.recorderFinalized = true; }
        catch { report.forced = true; }
      }
      // 6. await the reporter's one shared keepalive POST. A true value means
      //    the server actually acknowledged the capture request with HTTP 2xx.
      try {
        const capture = await withTimeout(flushSessionCapture(captureSid), T_CAPTURE);
        report.captureFlushed = capture.acknowledged;
      } catch {
        report.captureFlushed = false;
      }
      // 7. clear the session id
      app.setCurrentSessionId("");
    })();

    try { await withTimeout(run, T_GLOBAL); }
    catch {
      // force path — never trap the user in "stopping"
      report.forced = true;
      try { void client?.disconnect?.(); } catch { /* ignore */ }
      for (const tr of micTracks) { try { if (tr.readyState !== "ended") tr.stop(); } catch { /* ignore */ } }
      app.setCurrentSessionId("");
    }
    return report;
  }, [client, app, waitForTerminal]);

  const endSession = useCallback(async (reason: EndedReason = "user") => {
    if (!enabled) {
      try { await client?.disconnect?.(); } finally { app.setCurrentSessionId(""); }
      setEndedReason(reason); setPhase("ended");
      return;
    }
    if (teardownRef.current) { await teardownRef.current.catch(() => {}); return; } // idempotent
    setEndedReason(reason);
    setPhase("stopping");
    setOverlayVisible(true); // show the "Ending…" buffering animation immediately

    const p = gracefulTeardown(reason).then((rep) => { setLastTeardown(rep); return rep; });
    teardownRef.current = p;
    // Deliberate grace window: let the stream close AND keep the overlay up for
    // ~graceMs, so End always shows a graceful closing pause before the modal.
    await Promise.all([p.catch(() => null), sleep(graceMs)]);
    setOverlayVisible(false);
    teardownRef.current = null;
    wasLiveRef.current = false;
    setPhase(reconnectPendingRef.current ? "idle" : "ended");
  }, [enabled, client, app, gracefulTeardown, graceMs]);
  endSessionRef.current = endSession;

  const beginSession = useCallback(async (opts?: StartOptions) => {
    if (!enabled) { await rawConnect(opts); return; }
    if (phaseRef.current === "starting" || phaseRef.current === "live") return; // re-entrancy guard
    if (teardownRef.current) {                    // BUFFER: wait for the in-flight teardown to finish
      reconnectPendingRef.current = true;
      await teardownRef.current.catch(() => {});
    }
    reconnectPendingRef.current = false;
    setOverlayVisible(false);
    setEndedReason(null);
    if (connectRef.current) { await connectRef.current; return; } // de-dupe double-Start
    setPhase("starting");
    // rawConnect swallows its own errors (sets connectionError), and the WS path has
    // no built-in timeout — so a failed OR hung connect would otherwise leave us in
    // "starting" forever. Bound it and recover to the landing if the transport never
    // actually connects, so the user can retry (the error shows under the Start button).
    const cp = withTimeout(rawConnect(opts), CONNECT_TIMEOUT_MS).finally(() => { connectRef.current = null; });
    connectRef.current = cp;
    try { await cp; } catch { /* connect failed or timed out */ }
    if (!CONNECTED.has(client?.state ?? "")) {
      // Only tear down if there's actually a session to close. Calling disconnect() on a
      // never-begun client throws "Session ended: please call .begin() first" (benign,
      // also guarded globally); skip it when the transport is already terminal.
      const st = client?.state ?? "";
      if (STARTING.has(st) || CONNECTED.has(st)) {
        try { await client?.disconnect?.(); } catch { /* ignore */ }
      }
      app.setCurrentSessionId("");
      setPhase("idle");
    }
  }, [enabled, rawConnect, client, app]);

  const dismiss = useCallback(() => {
    setPhase("idle"); setEndedReason(null); recorderRef.current.clear();
  }, []);

  // Drive phase from the transport, and route involuntary drops through the gate.
  useEffect(() => {
    if (CONNECTED.has(transportState)) {
      wasLiveRef.current = true;
      setPhase((p) => (p === "stopping" ? p : "live"));
      const r = recorderRef.current;
      if (app.recordSession && r.canRecord && !r.isRecording) r.start();
    } else if (STARTING.has(transportState)) {
      setPhase((p) => (p === "stopping" || p === "ended" ? p : "starting"));
    } else if (TERMINAL.has(transportState)) {
      if (wasLiveRef.current && !teardownRef.current) {
        wasLiveRef.current = false;
        void endSessionRef.current("error"); // unexpected drop of a live session
      } else if (phaseRef.current === "starting" && !teardownRef.current) {
        // The transport reached a terminal (error/disconnected) state DURING connect —
        // e.g. a fatal WS error before begin() completes. Recover to idle immediately
        // instead of hanging on "Connecting" until CONNECT_TIMEOUT_MS fires.
        app.setCurrentSessionId("");
        setPhase("idle");
      }
    }
  }, [transportState, app.recordSession]);

  // Dev/SQA hook: expose the machine + last teardown report.
  useEffect(() => {
    (window as unknown as { __session?: unknown }).__session = { phase, endedReason, overlayVisible, lastTeardown };
  }, [phase, endedReason, overlayVisible, lastTeardown]);

  const value = useMemo<SessionLifecycleValue>(() => ({
    phase, endedReason, overlayVisible, connectionError, clearError,
    beginSession, endSession, dismiss,
    isRecording: recorder.isRecording, recording: recorder.recording,
    downloadRecording: recorder.download, clearRecording: recorder.clear,
    lastTeardown,
  }), [phase, endedReason, overlayVisible, connectionError, clearError, beginSession, endSession, dismiss,
      recorder.isRecording, recorder.recording, recorder.download, recorder.clear, lastTeardown]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSessionLifecycle(): SessionLifecycleValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSessionLifecycle must be used within SessionLifecycleProvider");
  return v;
}
