// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Settings page (opened from the gear on the main page): Model URL, Tools,
// Audio devices, and Prompt — everything that used to clutter the main view.

import { usePipecatClientMediaDevices } from "@pipecat-ai/client-react";
import { useApp } from "../../context/useApp";

function DeviceSelect({
  label, devices, selectedId, onChange,
}: Readonly<{ label: string; devices: MediaDeviceInfo[]; selectedId?: string; onChange: (id: string) => void }>) {
  return (
    <label className="set-field">
      <span className="set-field__label">{label}</span>
      <select className="set-select" value={selectedId ?? ""} onChange={(e) => onChange(e.target.value)}>
        {devices.length === 0 && <option value="">No devices found</option>}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label || "Unknown device"}</option>
        ))}
      </select>
    </label>
  );
}

function Section({ icon, title, children }: Readonly<{ icon: string; title: string; children: React.ReactNode }>) {
  return (
    <section className="set-section">
      <h3 className="set-section__title">{icon} {title}</h3>
      {children}
    </section>
  );
}

export function SettingsPage({ onClose }: Readonly<{ onClose: () => void }>) {
  const {
    selectedLLM,
    modelUrlOverride, setModelUrlOverride,
    selectedPrompt, promptOverride, setPromptOverride,
    ttsServices, selectedTTSId, selectTTS,
  } = useApp();
  const { availableMics, selectedMic, updateMic, availableSpeakers, selectedSpeaker, updateSpeaker } = usePipecatClientMediaDevices();

  const micId = "deviceId" in selectedMic ? selectedMic.deviceId : undefined;
  const spkId = "deviceId" in selectedSpeaker ? selectedSpeaker.deviceId : undefined;
  const basePrompt = selectedPrompt?.content ?? "";

  return (
    <div className="page-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="page-panel">
        <div className="page-panel__head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">×</button>
        </div>

        <div className="page-panel__body">
          <Section icon="🧠" title="Model">
            <label className="set-field">
              <span className="set-field__label">Language model</span>
              <span className="set-value">{selectedLLM?.name ?? "Default"}</span>
            </label>
            <label className="set-field">
              <span className="set-field__label">Local model URL</span>
              <input
                className="set-input"
                placeholder={selectedLLM?.baseUrl || "http://…/v1"}
                value={modelUrlOverride}
                onChange={(e) => setModelUrlOverride(e.target.value)}
              />
              <span className="set-hint">Leave blank to use the pipeline's built-in endpoint ({selectedLLM?.baseUrl || "default"}).</span>
            </label>
          </Section>

          {ttsServices.length > 1 && (
            <Section icon="🔊" title="Voice (text-to-speech)">
              <p className="set-hint">Which engine speaks the agent's replies. Applies to your next session.</p>
              <div className="set-tts-options" role="radiogroup" aria-label="Text-to-speech engine">
                {ttsServices.map((svc) => {
                  const on = selectedTTSId === svc.id;
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`set-tts-btn ${on ? "on" : ""}`}
                      onClick={() => selectTTS(svc.id)}
                    >
                      {svc.name}
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          <Section icon="🎧" title="Audio">
            <DeviceSelect label="Input device (microphone)" devices={availableMics} selectedId={micId} onChange={updateMic} />
            <DeviceSelect label="Output device (speaker)" devices={availableSpeakers} selectedId={spkId} onChange={updateSpeaker} />
          </Section>

          <Section icon="🎭" title="Prompt">
            <p className="set-hint">The example's system prompt. Edit to override; clear to restore the original.</p>
            <textarea
              className="set-textarea"
              rows={10}
              value={promptOverride || basePrompt}
              onChange={(e) => setPromptOverride(e.target.value === basePrompt ? "" : e.target.value)}
            />
            {promptOverride && (
              <button className="btn-ghost" onClick={() => setPromptOverride("")}>Restore original prompt</button>
            )}
          </Section>
        </div>

        <div className="page-panel__foot">
          <button className="btn-primary btn-bubbly" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
