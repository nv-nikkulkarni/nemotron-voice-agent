// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Configuration popup shown when a user clicks an example card. It surfaces the
// per-session choices that used to be buried in Settings:
//   • Generic Frontend/Backend → fixed Lightning Talker + reasoning Super Thinker,
//     TTS (Magpie / Chatterbox), and a grounded-tools multi-select.
//   • Omni → TTS only (no LLM, no tools — the Omni model is fixed and toolless).
// Everything is applied to the app store as the user interacts, so the Start button
// just launches. Prompt / audio / advanced settings stay in the ⚙ Settings page
// (noted at the bottom of the popup).

import { useEffect } from "react";
import { useApp } from "../../context/useApp";
import type { DeploymentOption, LLMService } from "../../api";

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

const TTS_OPTIONS = [
  { key: "magpie", test: /magpie/i, label: "Magpie", sub: "Multilingual · natural (default)" },
  { key: "chatterbox", test: /chatterbox/i, label: "Chatterbox", sub: "Expressive multilingual" },
];

// Defaults the user asked for: weather, stock, web search, BMI (calculate_bmi).
const DEFAULT_TOOLS = ["get_weather", "get_stock_price", "web_search", "calculate_bmi"];
const HIDDEN_TOOLS = new Set(["get_news_headlines"]);
const TOOL_LABELS: Record<string, string> = {
  get_weather: "Weather",
  get_stock_price: "Stock price",
  web_search: "Web search",
  calculate_bmi: "BMI",
  convert_currency: "Currency convert",
  get_current_date_time: "Date & time",
  generate_random_number: "Random number",
};

function labelFor(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ExampleConfigModal({
  option, connecting, connectionError, onStart, onClose,
}: Readonly<{
  option: DeploymentOption;
  connecting: boolean;
  connectionError: string;
  onStart: () => void;
  onClose: () => void;
}>) {
  const {
    llms, selectedLLMId,
    ttsServices, selectedTTSId, selectTTS,
    tools, selectedTools, toggleTool, setSelectedTools,
    recordSession, setRecordSession, storeConsent, setStoreConsent,
    reasoning, setReasoning,
  } = useApp();

  const isGeneric = option.key === "generic-frontend-backend-agent";
  // Omni pays a much steeper reasoning cost than the cascaded pipeline: its
  // Speaker returns a single JSON envelope and TTS cannot start until that
  // envelope fully parses, so the whole chain-of-thought is silence.
  const isOmni = option.key.startsWith("omni");
  const meta = EXAMPLE_TITLES[option.key] ?? option.label;

  const ttsChoices = TTS_OPTIONS
    .map((o) => ({ ...o, svc: ttsServices.find((t) => o.test.test(t.id) || o.test.test(t.name)) }))
    .filter((o) => o.svc);
  const toolList = tools.filter((t) => !HIDDEN_TOOLS.has(t.name));

  // Apply the requested voice default when the popup opens. The generic agent's
  // Lightning/Super roles are registry- and pipeline-owned, not user-selectable.
  useEffect(() => {
    const curTts = ttsServices.find((t) => t.id === selectedTTSId);
    const curTtsOffered = !!curTts && TTS_OPTIONS.some((o) => o.test.test(curTts.id) || o.test.test(curTts.name));
    const magpie = ttsServices.find((t) => /magpie/i.test(t.id) || /magpie/i.test(t.name)) ?? ttsChoices[0]?.svc;
    if (!curTtsOffered && magpie) selectTTS(magpie.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option.key, ttsServices.length]);

  // Default tool selection (generic only) once the catalog is loaded.
  useEffect(() => {
    if (!isGeneric || !toolList.length) return;
    const avail = new Set(toolList.map((t) => t.name));
    setSelectedTools(DEFAULT_TOOLS.filter((n) => avail.has(n)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option.key, toolList.length]);

  // Reset reasoning only when the selected model or that model's catalog default
  // changes. Depending on the whole llms array caused ordinary context re-renders to
  // overwrite a manual toggle immediately.
  const selectedReasoningDefault = llmCatalogReasoningDefault(llms.find((l) => l.id === selectedLLMId));
  useEffect(() => {
    setReasoning(selectedReasoningDefault);
  }, [selectedLLMId, selectedReasoningDefault, setReasoning]);

  return (
    <div className="ex-config__backdrop" role="dialog" aria-modal="true" aria-label={`Configure ${meta}`} onClick={onClose}>
      <div className="ex-config" onClick={(e) => e.stopPropagation()}>
        <div className="ex-config__head">
          <h2 className="ex-config__title">{meta}</h2>
          <button type="button" className="ex-config__close" aria-label="Close" onClick={onClose}>×</button>
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
            <h3 className="ex-config__label">Voice (text-to-speech)</h3>
            <div className="ex-config__opts">
              {ttsChoices.map((o) => (
                <label key={o.key} className={`ex-opt ${selectedTTSId === o.svc!.id ? "on" : ""}`}>
                  <input type="radio" name="tts" checked={selectedTTSId === o.svc!.id} onChange={() => selectTTS(o.svc!.id)} />
                  <span className="ex-opt__body"><span className="ex-opt__name">{o.label}</span><span className="ex-opt__sub">{o.sub}</span></span>
                </label>
              ))}
            </div>
          </section>
        )}

        {isGeneric && toolList.length > 0 && (
          <section className="ex-config__section">
            <h3 className="ex-config__label">Tools <span className="ex-config__hint">the assistant may call</span></h3>
            <div className="ex-config__tools">
              {toolList.map((t) => (
                <label key={t.name} className={`ex-tool ${selectedTools.includes(t.name) ? "on" : ""}`} title={t.description}>
                  <input type="checkbox" checked={selectedTools.includes(t.name)} onChange={() => toggleTool(t.name)} />
                  <span>{labelFor(t.name)}</span>
                </label>
              ))}
            </div>
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

        <p className="ex-config__note">
          <span className="ex-config__gear" aria-hidden>⚙</span>
          {isGeneric
            ? "The grounded agent prompts and model roles are fixed; use settings for audio, voice, and other session controls."
            : "To modify the prompt, audio and other settings, click the settings icon — then restart the example pipeline after your changes take effect."}
        </p>

        {connectionError && <p className="ex-config__error">{connectionError}</p>}

        <div className="ex-config__actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={connecting}>Cancel</button>
          <button type="button" className="btn-primary btn-bubbly" onClick={onStart} disabled={connecting}>
            {connecting ? "Connecting…" : "Start conversation"}
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
