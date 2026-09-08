// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// "Active pipeline" card shown on the conversation page: exactly the NIMs and
// tools the running pipeline is using. Replaces the standalone Services / Tools
// tabs in the curated demo.

import { useApp } from "../../context/useApp";

function Row({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="pipe-use__row">
      <span className="pipe-use__label">{label}</span>
      <span className="pipe-use__value" title={value}>{value}</span>
    </div>
  );
}

export function PipelineInUse() {
  const {
    selectedExample, activePrompt,
    selectedLLM, selectedASR, selectedTTS,
    selectedTools,
  } = useApp();

  const slots = new Set(selectedExample?.slots ?? []);

  return (
    <div className="card sidebar-card pipe-use">
      <p className="text-xs text-secondary mb-2">ACTIVE PIPELINE</p>

      {activePrompt && <Row label="Persona" value={activePrompt.title} />}
      {slots.has("asr") && <Row label="Speech-to-text" value={selectedASR?.name ?? "Default NIM"} />}
      {slots.has("llm") && <Row label="Language model" value={selectedLLM?.name ?? "Default NIM"} />}
      {slots.has("tts") && <Row label="Text-to-speech" value={selectedTTS?.name ?? "Default NIM"} />}

      <div className="pipe-use__tools">
        <span className="pipe-use__label">Tools in use</span>
        {selectedTools.length ? (
          <div className="pipe-use__chips">
            {selectedTools.map((name) => (
              <span key={name} className="tool-chip">{name}</span>
            ))}
          </div>
        ) : (
          <span className="pipe-use__value">None</span>
        )}
      </div>
    </div>
  );
}
