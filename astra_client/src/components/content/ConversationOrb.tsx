// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// The live-session hero band: a greenish turbulent orb whose shell reacts to the
// mic input intensity, a caption reflecting who is speaking, and a small
// end-to-end latency readout. Clicking it opens a breakdown panel in the open
// space beside the orb, showing where the time went for each server stage.
// The data is parsed from Pipecat's `latency-breakdown` server message.

import { useCallback, useEffect, useRef, useState } from "react";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { useRTVIClientEvent } from "@pipecat-ai/client-react";
import { useAudioAnalysers } from "../../hooks/useAudioAnalysers";
import { SphereWaveVisualizer } from "./SphereWaveVisualizer";
import { installMasterAudioTap, outputRms } from "../../demo/masterAudioTap";
import {
  mergeAgentStageMetrics,
  parseAgentStageMetrics,
  type AgentStageMetricSnapshot,
} from "../../demo/frontendBackendStageMetrics";
import {
  buildAgentTimeline,
  selectFirstAudioLatency,
  suppressDuplicateLlmRows,
  timelineDomainMs,
  type AgentTimelineStage,
} from "../../demo/latencyTimeline";

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
  const [clientFirstAudioMs, setClientFirstAudioMs] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<LatRow[] | null>(null);
  const [agentBreakdown, setAgentBreakdown] = useState<AgentStageMetricSnapshot | null>(null);
  const [agentMetricOffsets, setAgentMetricOffsets] = useState<Record<string, number>>({});
  const [showBreakdown, setShowBreakdown] = useState(false);
  const turnOriginRef = useRef<number | null>(null);
  const clientFirstAudioRecordedRef = useRef(false);
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
    useCallback(() => {
      setUserSpeaking(false);
      setThinking(true);
      setLatencyMs(null);
      setClientFirstAudioMs(null);
      setBreakdown(null);
      setAgentBreakdown(null);
      setAgentMetricOffsets({});
      setPlayoutMs(null);
      clientFirstAudioRecordedRef.current = false;
      turnOriginRef.current = performance.now();
    }, []),
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
          if (audible) {
            const now = performance.now();
            setPlayoutMs(Math.max(0, now - t0));
            if (turnOriginRef.current != null && !clientFirstAudioRecordedRef.current) {
              clientFirstAudioRecordedRef.current = true;
              setClientFirstAudioMs(Math.max(0, now - turnOriginRef.current));
            }
          }
          if (playoutTimerRef.current) { clearInterval(playoutTimerRef.current); playoutTimerRef.current = null; }
        }
      }, 20);
    }, []),
  );
  useRTVIClientEvent(RTVIEvent.BotStoppedSpeaking, useCallback(() => setBotSpeaking(false), []));
  useEffect(() => { installMasterAudioTap(); }, []);
  useEffect(() => () => { if (playoutTimerRef.current) clearInterval(playoutTimerRef.current); }, []);

  useRTVIClientEvent(
    RTVIEvent.Metrics,
    useCallback((metrics: unknown) => {
      const updates = parseAgentStageMetrics(metrics);
      if (updates.length > 0) {
        const observedOffset = turnOriginRef.current == null ? 0 : performance.now() - turnOriginRef.current;
        setAgentMetricOffsets((current) => {
          const next = { ...current };
          for (const row of updates) {
            if (next[row.id] == null) next[row.id] = observedOffset;
          }
          return next;
        });
        setAgentBreakdown((current) => mergeAgentStageMetrics(current, updates));
      }
    }, []),
  );

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
      // Also mirror the existing RTVI event as a browser event for automation. A
      // tool can start and finish inside one React render batch, so the visible
      // badge alone is not a reliable event log for a Playwright assertion.
      else if (message?.type === "tool-call") {
        const tool = message.tool ?? null;
        setActiveTool(tool);
        if (tool) window.dispatchEvent(new CustomEvent("nva:tool-call", { detail: { tool } }));
      }
      else if (message?.type === "tool-call-done") setActiveTool(null);
    }, []),
  );

  let caption = "Connected — just start talking";
  let state = "idle";
  if (botSpeaking) { caption = "Nemotron Voice Agent is speaking…"; state = "bot"; }
  else if (thinking) { caption = "Thinking…"; state = "thinking"; }
  else if (userSpeaking) { caption = "Listening to you…"; state = "user"; }

  const hasAgentBreakdown = !!agentBreakdown && agentBreakdown.rows.length > 0;
  const firstAudioMs = selectFirstAudioLatency(latencyMs, clientFirstAudioMs);
  const clientObservedLatency = latencyMs == null && clientFirstAudioMs != null;
  const pipelineRows = suppressDuplicateLlmRows(breakdown, hasAgentBreakdown);
  const timeline = buildAgentTimeline(agentBreakdown, agentMetricOffsets, firstAudioMs);
  const timelineMaxMs = timelineDomainMs(timeline.maxMs);
  const hasBreakdown = hasAgentBreakdown || pipelineRows.length > 0;

  const renderTimelineStage = (stage: AgentTimelineStage) => {
    const left = Math.min(100, (stage.startMs / timelineMaxMs) * 100);
    const width = Math.max(2, Math.min(100 - left, (stage.durationMs / timelineMaxMs) * 100));
    const ttft = stage.ttftMs == null ? null : Math.min(100, (stage.ttftMs / stage.durationMs) * 100);
    return (
      <li key={stage.id} className={`lat-stage lat-stage--${stage.kind}`} title={stage.outcome ? `Outcome: ${stage.outcome}` : undefined}>
        <div className="lat-stage__head">
          <span>{stage.label}</span>
          <span>{Math.round(stage.durationMs)} ms total</span>
        </div>
        <div className="lat-stage__track" aria-label={`${stage.label}: ${Math.round(stage.durationMs)} milliseconds`}>
          {firstAudioMs != null && firstAudioMs <= timelineMaxMs && (
            <span className="lat-stage__audio" style={{ left: `${(firstAudioMs / timelineMaxMs) * 100}%` }} aria-hidden />
          )}
          <span className="lat-stage__bar" style={{ left: `${left}%`, width: `${width}%` }}>
            {ttft != null && <span className="lat-stage__ttft" style={{ left: `${ttft}%` }} aria-hidden />}
          </span>
        </div>
        <div className="lat-stage__meta">
          <span>{stage.microcopy}</span>
          {stage.ttftMs != null && <span>First token {Math.round(stage.ttftMs)} ms</span>}
        </div>
      </li>
    );
  };

  return (
    <div className="conv-orb-band" data-tour="conversation-tools">
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

      <aside
        className={`conv-latency${showBreakdown && hasBreakdown ? " is-expanded" : ""}`}
        data-tour="conversation-latency"
        aria-label="Conversation latency"
      >
        <button
          type="button"
          className="conv-latency__btn"
          disabled={!hasBreakdown}
          aria-expanded={showBreakdown}
          onClick={() => setShowBreakdown((v) => !v)}
          title={hasBreakdown ? "Click for the latency breakdown" : "Time from user silence to first audible bot audio"}
        >
          <span className="conv-latency__label">
            {clientObservedLatency ? "End-to-end latency" : "Time to first audio"}{hasBreakdown ? " ⓘ" : ""}
          </span>
          <span className="conv-latency__value">{firstAudioMs != null ? `${(firstAudioMs / 1000).toFixed(2)}s` : "—"}</span>
        </button>

        {showBreakdown && hasBreakdown && (
          <div className="lat-breakdown" role="dialog" aria-label="Latency breakdown timeline">
            <div className="lat-breakdown__head">
              <div>
                <span>What happened after you stopped speaking</span>
                <small>{agentBreakdown?.turnId || "Current turn"}</small>
              </div>
              <button type="button" className="lat-breakdown__x" onClick={() => setShowBreakdown(false)} aria-label="Close">×</button>
            </div>
            {hasAgentBreakdown && (
              <>
                <div className="lat-axis" aria-hidden>
                  <span>0</span>
                  <span>{Math.round(timelineMaxMs / 2)} ms</span>
                  <span>{Math.round(timelineMaxMs)} ms</span>
                </div>
                <section className="lat-lane lat-lane--critical" aria-label="Stages before first audio">
                  <div className="lat-lane__head">
                    <span>Before you heard a response</span>
                    <span>Critical path</span>
                  </div>
                  <ul className="lat-timeline">{timeline.critical.map(renderTimelineStage)}</ul>
                </section>
                {!!timeline.asynchronous.length && (
                  <section className="lat-lane lat-lane--async" aria-label="Asynchronous delegated stages">
                    <div className="lat-lane__head">
                      <span>After delegation</span>
                      <span>Does not block first audio</span>
                    </div>
                    <ul className="lat-timeline">{timeline.asynchronous.map(renderTimelineStage)}</ul>
                  </section>
                )}
              </>
            )}
            {!!pipelineRows.length && <div className="lat-breakdown__section">Realtime voice pipeline</div>}
            <ul className="lat-breakdown__list" aria-label="Realtime voice pipeline latency">
              {pipelineRows.map((r, i) => (
                <li key={`${r.kind}-${i}`} className={`lat-row lat-row--${r.kind}`}>
                  <span className="lat-row__dot" aria-hidden />
                  <span className="lat-row__label">{r.label}</span>
                  <span className="lat-row__ms">{r.ms} ms</span>
                </li>
              ))}
            </ul>
            <div className="lat-breakdown__total">
              <span>{clientObservedLatency ? "Browser-observed end-to-end latency" : "Time to first audio (user silence → speech)"}</span>
              <span>{firstAudioMs != null ? `${Math.round(firstAudioMs)} ms` : "—"}</span>
            </div>
            {playoutMs != null && latencyMs != null && (
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
            <p className="lat-breakdown__playout-note">Browser playout measures bot-start → first audible sample.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
