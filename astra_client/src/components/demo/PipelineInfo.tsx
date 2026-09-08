// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Pipeline-info page (opened from the ⓘ icon): the models, tools, and prompt the
// selected example uses. Read-only — editing lives in Settings.

import { useApp } from "../../context/useApp";

export function PipelineInfo({ onClose }: Readonly<{ onClose: () => void }>) {
  const { selectedExample, selectedASR, selectedLLM, selectedTTS, selectedVoiceId, tools, selectedTools, selectedPrompt, promptOverride } = useApp();
  const slots = new Set(selectedExample?.slots ?? []);
  const activeTools = tools.filter((t) => selectedTools.includes(t.name));
  const promptText = promptOverride || selectedPrompt?.content || "(the example's built-in prompt)";

  return (
    <div className="page-overlay" role="dialog" aria-modal="true" aria-label="Pipeline info">
      <div className="page-panel">
        <div className="page-panel__head">
          <h2>{selectedExample?.label ?? "Pipeline"}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="page-panel__body">
          <section className="set-section">
            <h3 className="set-section__title">🧩 Models (NVIDIA NIMs)</h3>
            <div className="pi-models">
              {slots.has("asr") && <div className="pi-model"><span className="pi-model__k">Speech-to-text</span><span className="pi-model__v">{selectedASR?.name ?? "—"}</span></div>}
              <div className="pi-model"><span className="pi-model__k">{slots.has("asr") ? "Language model" : "Speech-to-speech model"}</span><span className="pi-model__v">{selectedLLM?.name ?? "—"}</span></div>
              {slots.has("tts") && <div className="pi-model"><span className="pi-model__k">Text-to-speech</span><span className="pi-model__v">{selectedTTS?.name ?? "—"}{selectedVoiceId ? ` · ${selectedVoiceId}` : ""}</span></div>}
            </div>
          </section>

          <section className="set-section">
            <h3 className="set-section__title">🛠️ Tools <span className="widget-count">{activeTools.length} on</span></h3>
            {activeTools.length === 0 ? (
              <p className="set-hint">No tools active for this example.</p>
            ) : (
              <div className="pi-tools">
                {activeTools.map((t) => (
                  <div key={t.name} className="pi-tool"><code>{t.name}</code><span>{t.description}</span></div>
                ))}
              </div>
            )}
          </section>

          <section className="set-section">
            <h3 className="set-section__title">🎭 Prompt {promptOverride && <span className="widget-count">edited</span>}</h3>
            <pre className="pi-prompt">{promptText}</pre>
          </section>
        </div>

        <div className="page-panel__foot">
          <button className="btn-primary btn-bubbly" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
