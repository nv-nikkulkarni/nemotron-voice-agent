// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// The live-session hero band: a greenish turbulent orb whose shell reacts to the
// mic input intensity, a caption reflecting who is speaking, and a small
// end-to-end latency readout. Clicking the readout opens a breakdown overlay
// showing where the time went (end-of-utterance detection + each server stage),
// parsed from pipecat's `latency-breakdown` server message.

import { useCallback, useEffect, useRef, useState } from "react";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { useRTVIClientEvent } from "@pipecat-ai/client-react";
import { useAudioAnalysers } from "../../hooks/useAudioAnalysers";
import { SphereWaveVisualizer } from "./SphereWaveVisualizer";
import { installMasterAudioTap, outputRms } from "../../demo/masterAudioTap";

interface LatRow { label: string; ms: number; kind: string }

// Map a raw breakdown event ("NvidiaLLMService#0: TTFB 0.202s") to a friendly row.
function friendly(prefix: string, metric: string): { label: string; kind: string } {
  const p = prefix.toLowerCase();
  if (p.startsWith("user turn")) return { label: "End-of-utterance (VAD + ASR finalize)", kind: "eou" };
  if (p.includes("sttservice") || p.includes("asr") || p.includes("stt")) return { label: "ASR — first token", kind: "asr" };
  if (p.includes("llmservice") || p.includes("llm")) return { label: "LLM — first token", kind: "llm" };
  if (p.includes("ttsservice") || p.includes("tts") || p.includes("speech"))
    return { label: metric.includes("aggregation") ? "TTS — text aggregation" : "TTS — first audio", kind: "tts" };
  return { label: `Tool — ${prefix}`, kind: "tool" };
}

function parseBreakdown(events: string[]): LatRow[] {
  const rows: LatRow[] = [];
  for (const ev of events || []) {
    const m = /^(.*?):\s*(.*?)([\d.]+)\s*s\s*$/.exec(ev);
    if (!m) continue;
    rows.push({ ...friendly(m[1].trim(), m[2].trim()), ms: Math.round(parseFloat(m[3]) * 1000) });
  }
  return rows;
}

export function ConversationOrb() {
  const { userAnalyser, botAnalyser } = useAudioAnalysers();
  const [botSpeaking, setBotSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<LatRow[] | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  // Tool the model just chose to call (from the server `tool-call` message). Shown in a
  // small box while the tool runs; cleared when the bot starts speaking the result.
  const [activeTool, setActiveTool] = useState<string | null>(null);
  // Client-side audio playout tail (bot-start event → first audible bot sample),
  // the one piece the server-side latency can't see. Measured off botAnalyser.
  const [playoutMs, setPlayoutMs] = useState<number | null>(null);
  const playoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useRTVIClientEvent(
    RTVIEvent.UserStartedSpeaking,
    useCallback(() => { setUserSpeaking(true); setThinking(false); }, []),
  );
  useRTVIClientEvent(
    RTVIEvent.UserStoppedSpeaking,
    useCallback(() => { setUserSpeaking(false); setThinking(true); }, []),
  );
  useRTVIClientEvent(
    RTVIEvent.BotStartedSpeaking,
    useCallback(() => {
      setBotSpeaking(true);
      setThinking(false);
      setActiveTool(null); // bot is now speaking the tool result — hide the tool box
      // Time from this "bot started" signal to the first audible bot sample at the
      // WebAudio output — the browser's jitter/playout buffer, which the server
      // latency omits. Uses the master output tap (bot audio isn't a track on WS).
      if (playoutTimerRef.current) clearInterval(playoutTimerRef.current);
      const t0 = performance.now();
      playoutTimerRef.current = setInterval(() => {
        const audible = outputRms() > 0.01;
        if (audible || performance.now() - t0 > 1500) {
          if (audible) setPlayoutMs(Math.max(0, performance.now() - t0));
          if (playoutTimerRef.current) { clearInterval(playoutTimerRef.current); playoutTimerRef.current = null; }
        }
      }, 20);
    }, []),
  );
  useRTVIClientEvent(RTVIEvent.BotStoppedSpeaking, useCallback(() => setBotSpeaking(false), []));
  useEffect(() => { installMasterAudioTap(); }, []);
  useEffect(() => () => { if (playoutTimerRef.current) clearInterval(playoutTimerRef.current); }, []);

  // Latency + breakdown come from pipecat's UserBotLatencyObserver over RTVI:
  //  - `user-bot-latency`  : the headline server response time (VAD-stop → first bot audio)
  //  - `latency-breakdown` : per-stage timeline (end-of-utterance + ASR/LLM/tool/TTS)
  useRTVIClientEvent(
    RTVIEvent.ServerMessage,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useCallback((message: any) => {
      if (message?.type === "user-bot-latency") setLatencyMs((message.latency ?? 0) * 1000);
      else if (message?.type === "latency-breakdown") setBreakdown(parseBreakdown(message.events || []));
      // `tool-call` : the LLM chose a tool and is about to call it (show the box).
      else if (message?.type === "tool-call") setActiveTool(message.tool ?? null);
      else if (message?.type === "tool-call-done") setActiveTool(null);
    }, []),
  );

  let caption = "Connected — just start talking";
  let state = "idle";
  if (botSpeaking) { caption = "Nemotron Voice Agent is speaking…"; state = "bot"; }
  else if (thinking) { caption = "Thinking…"; state = "thinking"; }
  else if (userSpeaking) { caption = "Listening to you…"; state = "user"; }

  const hasBreakdown = !!breakdown && breakdown.length > 0;

  return (
    <div className="conv-orb-band">
      <div className="conv-orb-canvas conv-sphere-canvas">
        <SphereWaveVisualizer userAnalyser={userAnalyser} botAnalyser={botAnalyser} thinking={thinking} />
      </div>
      <div className={`conv-orb-caption conv-orb-caption--${state}`}>
        <span className="conv-orb-dot" />
        <span>{caption}</span>
      </div>

      {activeTool && (
        <div className="conv-tool" role="status" aria-live="polite" title={`The assistant is calling the ${activeTool} tool`}>
          <span className="conv-tool__dot" />
          <span className="conv-tool__label">Calling tool</span>
          <span className="conv-tool__name">{activeTool}</span>
        </div>
      )}

      <div className="conv-latency">
        <button
          type="button"
          className="conv-latency__btn"
          disabled={!hasBreakdown}
          aria-expanded={showBreakdown}
          onClick={() => setShowBreakdown((v) => !v)}
          title={hasBreakdown ? "Click for the latency breakdown" : "Server response time (user → first bot audio)"}
        >
          <span className="conv-latency__label">End-to-end latency{hasBreakdown ? " ⓘ" : ""}</span>
          <span className="conv-latency__value">{latencyMs != null ? `${(latencyMs / 1000).toFixed(2)}s` : "—"}</span>
        </button>

        {showBreakdown && hasBreakdown && (
          <div className="lat-breakdown" role="dialog" aria-label="Latency breakdown">
            <div className="lat-breakdown__head">
              <span>Latency breakdown</span>
              <button type="button" className="lat-breakdown__x" onClick={() => setShowBreakdown(false)} aria-label="Close">×</button>
            </div>
            <ul className="lat-breakdown__list">
              {breakdown!.map((r, i) => (
                <li key={`${r.kind}-${i}`} className={`lat-row lat-row--${r.kind}`}>
                  <span className="lat-row__dot" aria-hidden />
                  <span className="lat-row__label">{r.label}</span>
                  <span className="lat-row__ms">{r.ms} ms</span>
                </li>
              ))}
            </ul>
            <div className="lat-breakdown__total">
              <span>Server response (VAD-stop → first audio)</span>
              <span>{latencyMs != null ? `${Math.round(latencyMs)} ms` : "—"}</span>
            </div>
            {playoutMs != null && (
              <div className="lat-breakdown__sub">
                <span>+ Audio playout (your browser)</span>
                <span>{Math.round(playoutMs)} ms</span>
              </div>
            )}
            {playoutMs != null && latencyMs != null && (
              <div className="lat-breakdown__felt">
                <span>True felt latency</span>
                <span>{Math.round(latencyMs + playoutMs)} ms</span>
              </div>
            )}
            <p className="lat-breakdown__note">
              Server stages are measured on the server; playout is measured in your browser
              (bot-start → first audible sample). True felt = server response + playout.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
