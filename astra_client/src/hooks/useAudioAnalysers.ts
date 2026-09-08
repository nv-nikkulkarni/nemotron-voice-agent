// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Builds Web Audio AnalyserNodes from the pipecat local (mic) and bot audio
// tracks, so the dual-orb visualizer can read real-time frequency energy.
// On WebSocket transport the bot MediaStreamTrack may be absent — the bot
// analyser is then null and the visualizer simply shows the user orb.

import { useEffect, useRef, useState } from "react";
import { usePipecatClientMediaTrack } from "@pipecat-ai/client-react";

type AudioCtxCtor = typeof AudioContext;

function useTrackAnalyser(track: MediaStreamTrack | null): AnalyserNode | null {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!track) {
      setAnalyser(null);
      return;
    }
    const Ctor: AudioCtxCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioCtxCtor }).webkitAudioContext;
    const ctx = ctxRef.current ?? new Ctor();
    ctxRef.current = ctx;
    if (ctx.state === "suspended") ctx.resume().catch(() => undefined);

    const stream = new MediaStream([track]);
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createAnalyser();
    node.fftSize = 512; // frequencyBinCount = 256, matches orbEngine's freqBuf
    node.smoothingTimeConstant = 0.8;
    source.connect(node);
    setAnalyser(node);

    return () => {
      try {
        source.disconnect();
      } catch {
        /* already gone */
      }
      setAnalyser(null);
    };
  }, [track]);

  // Tear the context down only on unmount.
  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    };
  }, []);

  return analyser;
}

export function useAudioAnalysers(): { userAnalyser: AnalyserNode | null; botAnalyser: AnalyserNode | null } {
  const userTrack = usePipecatClientMediaTrack("audio", "local");
  const botTrack = usePipecatClientMediaTrack("audio", "bot");
  return {
    userAnalyser: useTrackAnalyser(userTrack),
    botAnalyser: useTrackAnalyser(botTrack),
  };
}
