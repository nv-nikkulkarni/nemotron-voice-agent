// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Configuration popup opened from the launch bar below the example cards. It surfaces the
// per-session choices that used to be buried in Settings:
//   • Generic Frontend/Backend → fixed Lightning Talker + reasoning Super Thinker,
//     TTS (Magpie / Chatterbox), and a grounded-tools multi-select.
//   • Omni → TTS only (no LLM, no tools — the Omni model is fixed and toolless).
// Everything is applied to the app store as the user interacts, so the Start button
// just launches. Prompts open on their own pre-session page; Settings contains
// only the microphone and speaker controls.

import { useEffect, useRef, useState } from "react";
import { VoiceStudio } from "./VoiceStudio";
import { useApp } from "../../context/useApp";
import type { DeploymentOption, LLMService } from "../../api";
import { ToolSelector } from "./ToolSelector";

// A model's reasoning default comes from ONE place: the `enable_thinking` its
// catalog entry ships in extra_params (the services YAML). Lightning defaults
// on for reliable tool-calling; other models keep their catalog-declared value,
// and the user can still override it here. This used to be duplicated as a
// hardcoded flag per LLM_OPTION, which is exactly how Omni ended up
// reasoning: its model matched
// no LLM_OPTION, so the hardcoded default leaked in and every turn paid ~8s of
// chain-of-thought. Reading the catalog keeps one source of truth and covers
// custom LLMs too. Absent/malformed extra_params -> false, the fast path.
function llmCatalogReasoningDefault(svc: LLMService | undefined): boolean {
  if (!svc?.extraParams) return false;
  try {
    const parsed = JSON.parse(svc.extraParams);
    return Boolean(parsed?.extra_body?.chat_template_kwargs?.enable_thinking);
  } catch {
    return false;
  }
}



export function ExampleConfigModal({
  option, connecting, connectionError, onStart, onClose, onPrompts,
}: Readonly<{
  option: DeploymentOption;
  connecting: boolean;
  connectionError: string;
  onStart: () => void;
  onClose: () => void;
  onPrompts: () => void;
}>) {
  const {
    llms, llmsLoading, selectedLLMId,
    asrLoading,
    ttsServices, ttsLoading, selectedTTSId, selectTTS,
    promptsLoading,
    tools, toolsLoading, selectedTools, toggleTool,
    recordSession, setRecordSession, storeConsent, setStoreConsent,
    reasoning, setReasoning,
  } = useApp();

  const [voiceBusy, setVoiceBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  const isGeneric = option.domainProfile === "generic" || option.key === "generic-frontend-backend-agent";
  // Omni pays a much steeper reasoning cost than the cascaded pipeline: its
  // Speaker returns a single JSON envelope and TTS cannot start until that
  // envelope fully parses, so the whole chain-of-thought is silence.
  const isOmni = option.key.startsWith("omni");
  const meta = EXAMPLE_TITLES[option.key] ?? option.label;
  const configurationLoading = llmsLoading || asrLoading || ttsLoading || promptsLoading || toolsLoading;

  const ttsChoices = ttsServices.map((svc) => ({
    key: svc.id, svc, label: svc.name,
    sub: /zero.?shot/i.test(svc.model ?? "") ? "Custom voice from a reference sample"
      : /chatterbox/i.test(svc.id) ? "Expressive multilingual" : "Multilingual natural speech",
  }));
  // Apply the requested voice default when the popup opens. The generic agent's
  // Lightning/Super roles are registry- and pipeline-owned, not user-selectable.
  useEffect(() => {
    const curTts = ttsServices.find((t) => t.id === selectedTTSId);
    const curTtsOffered = !!curTts;
    const magpie = ttsServices.find((t) => /magpie/i.test(t.id) || /magpie/i.test(t.name)) ?? ttsChoices[0]?.svc;
    if (!curTtsOffered && magpie) selectTTS(magpie.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option.key, ttsServices.length]);

  // Reset reasoning only when the selected model or that model's catalog default
  // changes. Depending on the whole llms array caused ordinary context re-renders to
  // overwrite a manual toggle immediately.
  const selectedReasoningDefault = llmCatalogReasoningDefault(llms.find((l) => l.id === selectedLLMId));
  useEffect(() => {
    setReasoning(selectedReasoningDefault);
  }, [selectedLLMId, selectedReasoningDefault, setReasoning]);

  return (
    <div className="ex-config__backdrop" role="dialog" aria-modal="true" aria-label={`Configure ${meta}`} onClick={() => { if (!connecting && !voiceBusy) onClose(); }} onKeyDown={(event) => {
      if (event.key === "Escape" && !connecting && !voiceBusy) { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), audio[controls]') ?? [])];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div ref={panel} className="ex-config" onClick={(e) => e.stopPropagation()}>
        <div className="ex-config__head">
          <div><p className="studio-eyebrow">SESSION SETUP</p><h2 className="ex-config__title">{meta}</h2></div>
          <button ref={close} type="button" disabled={connecting || voiceBusy} className="ex-config__close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="ex-config__lead">Choose how this assistant runs, then start talking.</p>

        {isGeneric && (
          <section className="ex-config__section">
            <h3 className="ex-config__label">Agent model roles</h3>
            <div className="ex-config__opts">
              <div className="ex-opt on">
                <span className="ex-opt__body"><span className="ex-opt__name">Nemotron 3.5 Lightning</span><span className="ex-opt__sub">Talker · low latency · reasoning off</span></span>
              </div>
              <div className="ex-opt on">
                <span className="ex-opt__body"><span className="ex-opt__name">Nemotron 3 Super 120B-A12B</span><span className="ex-opt__sub">Thinker · grounded planning · reasoning on</span></span>
              </div>
            </div>
          </section>
        )}

        {ttsChoices.length > 0 && (
          <section className="ex-config__section">
            <h3 className="ex-config__label">Speech engine</h3>
            <div className="ex-config__opts">
              {ttsChoices.map((o) => (
                <label key={o.key} className={`ex-opt ${selectedTTSId === o.svc.id ? "on" : ""}`}>
                  <input type="radio" name="tts" disabled={connecting || voiceBusy} checked={selectedTTSId === o.svc.id} onChange={() => selectTTS(o.svc.id)} />
                  <span className="ex-opt__body"><span className="ex-opt__name">{o.label}</span><span className="ex-opt__sub">{o.sub}</span></span>
                </label>
              ))}
            </div>
          </section>
        )}

        <section className="ex-config__section">
          <h3 className="ex-config__label">Speaking voice</h3>
          <VoiceStudio key={selectedTTSId} onBusyChange={setVoiceBusy} />
        </section>

        {isGeneric && (
          <section className="ex-config__section">
            <h3 className="ex-config__label">Tools <span className="ex-config__hint">the assistant may call</span></h3>
            <ToolSelector
              tools={tools}
              selectedTools={selectedTools}
              loading={toolsLoading}
              onToggle={toggleTool}
            />
          </section>
        )}

        <div className="ex-config__toggles">
          {!isGeneric && <label className="record-toggle reasoning-toggle">
            <input type="checkbox" checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} />
            <span className="record-toggle__box" aria-hidden />
            <span>Reasoning
              <small className="consent-note">
                Nemotron thinks before answering — better tool-calling, but slower. Off by default.
              </small>
              {reasoning && (
                <small className="consent-note reasoning-warn" role="status">
                  ⚠ Adds several seconds to every reply{isOmni ? " — on this example you hear nothing at all until it finishes thinking" : ""}.
                </small>
              )}
            </span>
          </label>}
          <label className="record-toggle">
            <input type="checkbox" checked={recordSession} onChange={(e) => setRecordSession(e.target.checked)} />
            <span className="record-toggle__box" aria-hidden />
            Record this session
          </label>
          <label className="record-toggle consent-toggle">
            <input type="checkbox" checked={storeConsent} onChange={(e) => setStoreConsent(e.target.checked)} />
            <span className="record-toggle__box" aria-hidden />
            <span>Store my audio to help improve quality
              <small className="consent-note">If checked, this session’s microphone and assistant audio (plus a transcript) may be saved and reviewed by the NVIDIA team for quality and debugging. Leave unchecked to opt out.</small>
            </span>
          </label>
        </div>

        <div className="ex-config__prompts">
          <div><h3 className="ex-config__label">Prompts</h3><p className="set-hint">Prepare system prompts and persistent instructions before starting.</p></div>
          <button type="button" className="btn-secondary" disabled={connecting || voiceBusy} onClick={onPrompts}>Edit prompts</button>
        </div>

        {connectionError && <p role="alert" className="ex-config__error">{connectionError}</p>}

        <div className="ex-config__actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={connecting || voiceBusy}>Cancel</button>
          <button
            type="button"
            className="btn-primary btn-bubbly"
            onClick={onStart}
            disabled={connecting || configurationLoading || voiceBusy}
          >
            {connecting ? "Connecting…" : configurationLoading ? "Preparing…" : "Start conversation"}
          </button>
        </div>
      </div>
    </div>
  );
}

const EXAMPLE_TITLES: Record<string, string> = {
  "generic-frontend-backend-agent": "Generic Frontend/Backend Assistant",
  "omni-assistant-subagents": "Nemotron Omni Assistant",
};
