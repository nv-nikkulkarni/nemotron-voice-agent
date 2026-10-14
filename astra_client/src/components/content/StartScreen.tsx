// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// The curated demo landing page: two prebuilt pipelines you can talk to directly,
// or open in the builder to customize. Both are configurations of the one
// cascaded voice-agent pipeline (ASR → LLM → TTS + tools).

import { useApp } from "../../context/useApp";
import { useVoiceSession } from "../../hooks/useVoiceSession";
import { PRESETS, type PipelinePreset } from "../../demo/presets";

function prettyKey(key: string | undefined, fallback: string): string {
  if (!key) return fallback;
  return key
    .replace(/^nemotron-/, "")
    .replace(/-/g, " ")
    .replace(/\basr\b/i, "ASR")
    .replace(/\btts\b/i, "TTS")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function PresetCard({
  preset,
  onTalk,
  onCustomize,
  busy,
}: Readonly<{ preset: PipelinePreset; onTalk: () => void; onCustomize: () => void; busy: boolean }>) {
  return (
    <div className="preset-card" style={{ ["--preset-accent" as string]: preset.accent }}>
      <div className="preset-card__head">
        <span className="preset-card__icon" aria-hidden>{preset.icon}</span>
        <div>
          <h3 className="preset-card__title">{preset.title}</h3>
          <p className="preset-card__tagline">{preset.tagline}</p>
        </div>
      </div>

      <div className="preset-card__pipeline">
        <span className="pipe-tag">🎙️ {prettyKey(preset.asrKey, "ASR")}</span>
        <span className="pipe-arrow">→</span>
        <span className="pipe-tag">🧠 {prettyKey(preset.llmKey, "LLM")}</span>
        <span className="pipe-arrow">→</span>
        <span className="pipe-tag">🔊 {prettyKey(preset.ttsKey, "TTS")}</span>
      </div>

      <div className="preset-card__tools">
        {preset.tools.slice(0, 6).map((t) => (
          <span key={t} className="tool-chip">{t}</span>
        ))}
        <span className="preset-card__toolcount">{preset.tools.length} tools</span>
      </div>

      <div className="preset-card__try">
        {preset.suggestions.map((s) => (
          <span key={s} className="preset-chip">&ldquo;{s}&rdquo;</span>
        ))}
      </div>

      <div className="preset-card__actions">
        <button type="button" className="btn-primary" onClick={onTalk} disabled={busy}>
          {busy ? "Connecting…" : "▶ Talk"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCustomize} disabled={busy}>
          ⚙ Customize
        </button>
      </div>
    </div>
  );
}

export function StartScreen({ onCustomize }: Readonly<{ onCustomize?: () => void }>) {
  const { applyPreset } = useApp();
  const { connect, isConnecting, connectionError } = useVoiceSession();

  const talk = (preset: PipelinePreset) => {
    applyPreset(preset.id);
    void connect({ preset });
  };
  const customize = (preset: PipelinePreset) => {
    applyPreset(preset.id);
    onCustomize?.();
  };

  return (
    <div className="start-screen">
      <div className="start-screen__hero">
        <p className="start-screen__eyebrow">NVIDIA</p>
        <h2 className="start-screen__title">
          Nemotron <span className="accent">Voice Agent</span>
        </h2>
        <p className="start-screen__subtitle">
          Two ready-made pipelines to talk to — or open the builder and compose your own from every
          NIM, voice, and tool the deployment exposes.
        </p>
      </div>

      <div className="preset-grid">
        {PRESETS.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            busy={isConnecting}
            onTalk={() => talk(preset)}
            onCustomize={() => customize(preset)}
          />
        ))}
      </div>

      {onCustomize && (
        <button type="button" className="start-screen__customize" onClick={onCustomize}>
          ⚙ Open the pipeline builder →
        </button>
      )}

      {connectionError && <p className="start-screen__error">{connectionError}</p>}
    </div>
  );
}
