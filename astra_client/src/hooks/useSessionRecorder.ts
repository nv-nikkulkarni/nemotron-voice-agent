// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Opt-in session recorder for the clean demo UI. Mixes the pipecat local (mic)
// and bot audio MediaStreamTracks into a single MediaRecorder and produces a
// downloadable blob. On WebSocket transport the bot track can be absent — the
// recording then captures the user's mic only, which is still useful.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePipecatClientMediaTrack } from "@pipecat-ai/client-react";
import { demoConfig } from "../config";

type AudioCtxCtor = typeof AudioContext;

export interface SessionRecorder {
  /** True when the browser supports MediaRecorder and a mic track is live. */
  canRecord: boolean;
  isRecording: boolean;
  /** The finished recording, available after stop(). */
  recording: Blob | null;
  start: () => void;
  stop: () => void;
  /** Stop and resolve once the blob is finalized (for awaited teardown). */
  stopAndFinalize: () => Promise<Blob | null>;
  download: () => void;
  clear: () => void;
}

/** Best supported audio container/codec for the configured record format. */
function pickMimeType(): string {
  const fmt = demoConfig.recordFormat; // "webm"
  const candidates = [`audio/${fmt};codecs=opus`, `audio/${fmt}`, "audio/webm"];
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

export function useSessionRecorder(): SessionRecorder {
  const localTrack = usePipecatClientMediaTrack("audio", "local");
  const botTrack = usePipecatClientMediaTrack("audio", "bot");

  // Latest tracks kept in refs so start() reads live values without re-binding.
  const localRef = useRef<MediaStreamTrack | null>(null);
  const botRef = useRef<MediaStreamTrack | null>(null);
  localRef.current = localTrack;
  botRef.current = botTrack;

  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Blob | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const urlRef = useRef<string | null>(null);
  const mimeRef = useRef<string>("");
  // Resolver for stopAndFinalize(), fired from onstop once the blob is ready.
  const finalizeRef = useRef<((b: Blob | null) => void) | null>(null);

  const recorderSupported = typeof MediaRecorder !== "undefined";
  const canRecord = recorderSupported && !!localTrack;

  const start = useCallback(() => {
    if (!recorderSupported || recorderRef.current) return;

    const Ctor: AudioCtxCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: AudioCtxCtor }).webkitAudioContext;
    const ctx = new Ctor();
    ctxRef.current = ctx;
    if (ctx.state === "suspended") ctx.resume().catch(() => undefined);

    const dest = ctx.createMediaStreamDestination();
    let mixed = 0;
    const addTrack = (track: MediaStreamTrack | null | undefined) => {
      if (!track) return;
      try {
        ctx.createMediaStreamSource(new MediaStream([track])).connect(dest);
        mixed += 1;
      } catch {
        /* skip a track that can't be sourced */
      }
    };

    // User input (mic).
    addTrack(localRef.current);
    // Agent output (TTS): prefer the pipecat bot track; on transports where it is
    // not exposed as a track (e.g. WebSocket) capture the <audio> playback element
    // instead, so the agent's speech is always in the recording — a true end-to-end
    // session capture for debugging ASR / TTS / latency.
    if (botRef.current) {
      addTrack(botRef.current);
    } else {
      for (const el of Array.from(document.querySelectorAll("audio"))) {
        try {
          const cap = el as HTMLAudioElement & {
            captureStream?: () => MediaStream;
            mozCaptureStream?: () => MediaStream;
          };
          const stream = cap.captureStream?.() ?? cap.mozCaptureStream?.();
          if (stream) for (const tr of stream.getAudioTracks()) addTrack(tr);
        } catch {
          /* element not capturable */
        }
      }
    }
    if (mixed === 0) {
      ctx.close().catch(() => undefined);
      ctxRef.current = null;
      return;
    }

    // Drop any previous recording before starting a fresh one.
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setRecording(null);
    chunksRef.current = [];
    mimeRef.current = pickMimeType();

    const rec = mimeRef.current
      ? new MediaRecorder(dest.stream, { mimeType: mimeRef.current })
      : new MediaRecorder(dest.stream);
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
      const finished = blob.size > 0 ? blob : null;
      setRecording(finished);
      chunksRef.current = [];
      ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
      finalizeRef.current?.(finished);
      finalizeRef.current = null;
    };
    recorderRef.current = rec;
    rec.start();
    setIsRecording(true);
  }, [recorderSupported]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state !== "inactive") rec.stop();
    recorderRef.current = null;
    setIsRecording(false);
  }, []);

  const stopAndFinalize = useCallback((): Promise<Blob | null> => {
    const rec = recorderRef.current;
    if (!rec) return Promise.resolve(null);
    const done = new Promise<Blob | null>((resolve) => {
      finalizeRef.current = resolve;
    });
    if (rec.state !== "inactive") rec.stop(); // triggers onstop -> resolves `done`
    else { finalizeRef.current?.(null); finalizeRef.current = null; }
    recorderRef.current = null;
    setIsRecording(false);
    return done;
  }, []);

  const download = useCallback(() => {
    if (!recording) return;
    const url = urlRef.current ?? URL.createObjectURL(recording);
    urlRef.current = url;
    const a = document.createElement("a");
    a.href = url;
    a.download = `voice-session.${demoConfig.recordFormat || "webm"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [recording]);

  const clear = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setRecording(null);
  }, []);

  // Tear everything down on unmount.
  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      recorderRef.current = null;
      ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  return { canRecord, isRecording, recording, start, stop, stopAndFinalize, download, clear };
}
