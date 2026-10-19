// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Landing owns pre-session studio navigation and the capture choice.
// The connected view owns the live orb, transcript, and microphone controls.

import { useEffect, useState, type ReactNode } from "react";
import { useConnectionState } from "../../hooks/useConnectionState";
import { useSessionLifecycle } from "../../hooks/useSessionLifecycle";
import { useApp } from "../../context/useApp";
import { useDefaultLLMs, useVoiceCatalog, type DeploymentOption, type ExampleVariant } from "../../api";
import { ConversationPanel } from "../content/ConversationPanel";
import { WebcamVisionPanel } from "../WebcamVisionPanel";
import { MicButton } from "./MicButton";
import { EventLog } from "./EventLog";
import { architectureImageFor, requestArchitecture } from "../../demo/architecture";
import { languageName } from "../../demo/language";
import { demoConfig } from "../../config";
import {
  AGENT_SCHEMA, AGENT_VERSION, CUSTOM_BASE_EXAMPLE, agentFileName, downloadText, dumpAgentConfig, getModelChoice, setModelChoice, useAgentStore,
  type AgentConfig,
} from "../../demo/agentConfig";

interface ExampleMeta {
  accent: string;
  blurb: string;
  tags: string[];
  titleLines?: string[];
  samples?: string[];
  feature?: string;
  beta?: boolean;
  category?: string;
  /** One-line name for the launch dock. */
  shortName?: string;
  /** Per-variant samples and button copy, keyed by registry variant id. */
  variantCopy?: Record<string, { cta: string; samples?: string[] }>;
}

const EXAMPLE_META: Record<string, ExampleMeta> = {
  "generic-frontend-backend-agent": {
    accent: "#76b900",
    shortName: "Generic assistant",
    titleLines: ["Generic Frontend/Backend", "Assistant"],
    blurb: "A fast conversational Talker backed by a reasoning Super VL agent for grounded live tools and reliable answers.",
    tags: ["⚡ Choice of Talker", "🧠 Super VL Thinker", "🔊 Text-to-speech", "🛠️ Grounded tools"],
    samples: [
      "What's the weather in Tokyo?",
      "What's NVIDIA's current stock price?",
      "What's my BMI if I'm 70 kilos and 1.75 meters?",
    ],
  },
  "multilingual-generic-frontend-backend-agent": {
    accent: "#38bdf8",
    shortName: "Multilingual assistant",
    category: "Multilingual conversation + live tools",
    titleLines: ["Multilingual Frontend/Backend", "Assistant"],
    blurb: "The same grounded tools, in your language. A Gemma 4 Talker speaks with you while a reasoning Super VL agent works in the background.",
    tags: ["🌐 Multilingual ASR", "⚡ Gemma 4 Talker", "🧠 Super VL Thinker", "🛠️ Grounded tools"],
    variantCopy: {
      hindi: {
        cta: "हिन्दी · Hindi",
        samples: ["दिल्ली में आज मौसम कैसा है?", "NVIDIA का शेयर भाव क्या है?"],
      },
      multilingual: {
        cta: "🌐 Any language",
        samples: ["¿Qué tiempo hace en Madrid?", "Wie spät ist es in Tokio?"],
      },
    },
  },
  "omni-assistant-subagents": {
    accent: "#8b5cf6",
    shortName: "Omni assistant",
    beta: true,
    titleLines: ["Nemotron Omni Assistant", "Subagents"],
    blurb: "A single multimodal Omni model that listens and talks end-to-end, with webcam vision and media understanding.",
    tags: ["🗣️ Omni model", "📷 Webcam vision", "🖼️ Media"],
    feature: "📷 Turn on your webcam or 🖼️ upload an image or video — Omni can see it and talk about it live.",
    samples: [
      "What do you see on my camera?",
      "Tell me a short story about a robot",
      "What's seventeen times twenty three?",
    ],
  },
};

const FALLBACK_META: ExampleMeta = { accent: "#76b900", blurb: "", tags: [] };
/** The display title shown on an example's card, used wherever the example is named. */
function exampleTitle(option: DeploymentOption): string {
  return EXAMPLE_META[option.key]?.titleLines?.join(" ") ?? option.label;
}

// Cards show at most this many samples so the landing fits one screen.
const MAX_CARD_SAMPLES = 2;

function categoryFor(option: DeploymentOption, meta: ExampleMeta): string {
  if (meta.category) return meta.category;
  return option.key.startsWith("omni") ? "Multimodal conversation" : "Conversation + live tools";
}

function variantCta(meta: ExampleMeta, variant: ExampleVariant): string {
  return meta.variantCopy?.[variant.id]?.cta ?? `Try the ${variant.label.toLowerCase()}`;
}

/** "Nemotron 3.5 Lightning 30B A3B" → "Lightning", "Gemma 4 31B" → "Gemma 4": short enough for a segment. */
function shortModelName(name: string): string {
  return name.replace(/^Nemotron\s+[\d.]+\s+/i, "").replace(/\s+\d+B(\s+A\d+B)?.*$/i, "").trim() || name;
}

type SwitchOption = { id: string; label: string; title?: string; lang?: string };

/** A segmented choice inside a card. It only records the choice (never starts a session) and selects the card. */
function CardSwitch({
  groupId, label, options, value, disabled, onPick, children,
}: Readonly<{
  groupId: string;
  label: string;
  options: SwitchOption[];
  value: string;
  disabled: boolean;
  onPick: (id: string) => void;
  children?: ReactNode;
}>) {
  return (
    <div className="example-card__modes">
      <span className="ex-samples-label" id={groupId}>{label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={groupId}>
        {options.map((option) => {
          const checked = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={checked}
              className={`segmented__option${checked ? " is-active" : ""}`}
              title={option.title}
              lang={option.lang}
              disabled={disabled}
              onClick={(event) => { event.stopPropagation(); onPick(option.id); }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

/** The Generic card's Talker switch: the same per-example choice the Models page writes. */
function TalkerSwitch({ option, disabled, onPick }: Readonly<{ option: DeploymentOption; disabled: boolean; onPick: () => void }>) {
  const { data: llms = [] } = useDefaultLLMs(option.key);
  const store = useAgentStore();
  const talkers = llms.filter((llm) => llm.builtIn);
  const defaultTalker = String((option.defaults?.llm?.[0] as { id?: string } | undefined)?.id ?? talkers[0]?.id ?? "");
  const choice = store.modelChoices[option.key] ?? {};
  if (talkers.length < 2) return null;
  return (
    <CardSwitch
      groupId={`${option.key}-talker`}
      label="Talker"
      value={choice.talker ?? defaultTalker}
      disabled={disabled}
      options={talkers.map((llm) => ({
        id: llm.id,
        label: shortModelName(llm.name),
        title: `${llm.name}${llm.supportedLanguages?.length ? ` · speaks ${llm.supportedLanguages.join(", ")}` : ""}`,
      }))}
      onPick={(id) => {
        setModelChoice(option.key, { ...choice, talker: id === defaultTalker ? undefined : id });
        onPick();
      }}
    />
  );
}

/**
 * One shell for the three example cards: the whole card selects the example (a real button underneath the
 * content, so the keyboard and screen readers get it too), and an optional switch picks a mode or Talker.
 */
function ExampleCard({
  option, selected, onSelect, tags, samples, switcher,
}: Readonly<{
  option: DeploymentOption;
  selected: boolean;
  onSelect: () => void;
  tags?: string[];
  samples?: string[];
  switcher?: ReactNode;
}>) {
  const meta = EXAMPLE_META[option.key] ?? FALLBACK_META;
  return (
    <div
      className={`example-card ${selected ? "selected" : ""}`}
      style={{ ["--ex-accent" as string]: meta.accent }}
      onClick={onSelect}
    >
      <button
        type="button"
        className="example-card__select"
        onClick={(event) => { event.stopPropagation(); onSelect(); }}
        aria-pressed={selected}
        aria-label={`${selected ? "Selected" : "Select"} ${option.label}`}
      />
      <div className="example-card__topline">
        <span className="example-card__category">{categoryFor(option, meta)}{meta.beta && <span className="example-card__beta">Beta</span>}</span>
        <span className={`example-card__state ${selected ? "is-selected" : ""}`} aria-hidden="true">
          <i className="example-card__radio" />{selected ? "Selected" : ""}
        </span>
      </div>
      <div className="example-card__header">
        <span className="example-card__tile"><img className="example-card__logo" src="/nvidia-nim-icon.png" alt="NVIDIA NIM" /></span>
        <h3 className="example-card__title">
          {(meta.titleLines ?? [option.label]).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h3>
      </div>
      <p className="example-card__blurb">{meta.blurb}</p>
      <div className="example-card__tags">
        {(tags ?? meta.tags).map((tag) => (
          <span key={tag} className="ex-tag">{tag}</span>
        ))}
      </div>
      {switcher}
      {samples && samples.length > 0 && (
        <div className="example-card__samples example-card__footer">
          <span className="ex-samples-label">Try saying</span>
          <ul>
            {samples.slice(0, MAX_CARD_SAMPLES).map((sample) => (
              <li key={sample} lang={/[\u0900-\u097F]/.test(sample) ? "hi" : undefined}>“{sample}”</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Compact session-language picker for an open-language variant (same list as Voice studio). */
function SessionLanguagePicker({ disabled, talkerKey }: Readonly<{ disabled: boolean; talkerKey?: string }>) {
  const app = useApp();
  // Offer only languages the session's Talker speaks: the variant's Talker when it
  // names one, otherwise the selected LLM. The catalog id is stable before the list loads.
  const talkerId = talkerKey
    ? app.llms.find((llm) => llm.id.endsWith(`:${talkerKey}`))?.id ?? `self-hosted:${talkerKey}`
    : app.selectedLLM?.id;
  const { data: catalog, isLoading } = useVoiceCatalog(
    app.selectedTTS?.server, app.selectedTTS?.voiceId,
    app.selectedASR?.server, app.selectedASR?.model, app.selectedASR?.functionId,
    app.selectedTTS?.functionId, app.selectedTTS?.model,
    { pipelineMode: app.selectedExample?.key, llmId: talkerId },
  );
  const languages = catalog?.languages ?? [];
  const options = languages.includes(app.selectedSessionLanguage) ? languages : [app.selectedSessionLanguage, ...languages];

  return (
    <label className="startview__language">
      <span className="startview__selection-label">Language</span>
      <select
        className="set-select"
        value={app.selectedSessionLanguage}
        disabled={disabled || isLoading}
        onChange={(event) => { app.setSelectedSessionLanguage(event.target.value); app.setSelectedVoiceId(""); }}
      >
        {options.map((code) => <option key={code} value={code} title={code}>{languageName(code)}</option>)}
      </select>
    </label>
  );
}

type SetupNavigation = { onPrompts: () => void; onTools: () => void; onVoice: () => void; onModels: () => void; onBuild: () => void };

/** The fourth card: opens the guarded agent builder instead of selecting an example. */
function BuilderCard({ onBuild, disabled }: Readonly<{ onBuild: () => void; disabled: boolean }>) {
  return (
    <button
      type="button"
      className="example-card example-card--builder"
      style={{ ["--ex-accent" as string]: "#f59e0b" }}
      onClick={onBuild}
      disabled={disabled}
      aria-label="Build your own agent"
    >
      <div className="example-card__topline">
        <span className="example-card__category">Create + configure</span>
        <span className="example-card__state" aria-hidden="true">New</span>
      </div>
      <div className="example-card__header">
        <span className="example-card__tile"><img className="example-card__logo" src="/nvidia-nim-icon.png" alt="NVIDIA NIM" /></span>
        <h3 className="example-card__title"><span>Build Your Own</span><span>Agent</span></h3>
      </div>
      <p className="example-card__blurb">Describe a persona and domain in chat, pick the models and voice, and watch your pipeline take shape. Save it as a file and load it again.</p>
      <div className="example-card__tags">
        {["💬 Guided builder", "🧩 Models, voice & tools", "💾 Save & load YAML"].map((tag) => <span key={tag} className="ex-tag">{tag}</span>)}
      </div>
      <ol className="example-card__slot example-card__how">
        <li><b>1</b> Describe</li>
        <li><b>2</b> Pick models</li>
        <li><b>3</b> Save or talk</li>
      </ol>
      <div className="example-card__footer">
        <span className="ex-samples-label">Get started</span>
        <span className="example-card__link" aria-hidden="true">Open the builder →</span>
      </div>
    </button>
  );
}

function StartView({ connecting, onPrompts, onTools, onVoice, onModels, onBuild }: Readonly<{ connecting: boolean } & SetupNavigation>) {
  const app = useApp();
  const {
    deploymentOptions,
    selectedExample,
    selectExample,
    llmsLoading,
    asrLoading,
    ttsLoading,
    promptsLoading,
    toolsLoading,
  } = useApp();
  const { requestSession, connectionError } = useSessionLifecycle();
  const configurationLoading = llmsLoading || asrLoading || ttsLoading || promptsLoading || toolsLoading;
  // The launch variant chosen per example (e.g. multilingual vs. Hindi).
  const [variantByExample, setVariantByExample] = useState<Record<string, string>>({});
  const selectedVariants = selectedExample?.variants ?? [];
  const selectedVariant = selectedVariants.find((variant) => variant.id === variantByExample[selectedExample?.key ?? ""])
    ?? selectedVariants[0];

  const showBuilder = demoConfig.builderEnabled && deploymentOptions.some((option) => option.key === CUSTOM_BASE_EXAMPLE);

  // Save the selected example's current configuration as an agent file the builder can load.
  const saveAgent = () => {
    if (!selectedExample) return;
    const choice = getModelChoice(selectedExample.key);
    const variantTalker = selectedVariant?.llm ? app.llms.find((llm) => llm.id.endsWith(`:${selectedVariant.llm}`))?.id : undefined;
    const defaultBackend = String((selectedExample.defaults?.["thinker-llm"]?.[0] as { id?: string } | undefined)?.id ?? "");
    const config: AgentConfig = {
      schema: AGENT_SCHEMA,
      version: AGENT_VERSION,
      name: exampleTitle(selectedExample),
      base_example: selectedExample.key,
      language: selectedVariant?.session_language || app.selectedSessionLanguage,
      persona: { name: "", role: exampleTitle(selectedExample), tone: "friendly", about: "", always: [], never: [] },
      models: { talker: choice.talker ?? variantTalker ?? app.selectedLLM?.id ?? "", backend: choice.backend ?? defaultBackend },
      speech: {
        asr: app.selectedASR?.id ?? "",
        tts: app.selectedTTS?.id ?? "",
        voice: app.selectedVoiceId || app.selectedTTS?.voiceId || "",
        pronunciations: app.pronunciationOverrides,
      },
      tools: app.selectedTools,
    };
    downloadText(agentFileName(config), dumpAgentConfig(config));
  };

  // Picking a mode only selects it; the single Start button below begins the session.
  const pickVariant = (option: DeploymentOption, variant: ExampleVariant) => {
    selectExample(option.key);
    setVariantByExample((current) => ({ ...current, [option.key]: variant.id }));
  };
  const needsLanguage = Boolean(
    selectedVariant && !selectedVariant.session_language && selectedExample?.capabilities?.includes("session_languages"),
  );

  return (
    <div className="startview">
     <div className="startview__scroll">
      <div className="startview__hero" data-tour="welcome">
        <p className="startview__eyebrow">NVIDIA</p>
        <h1 className="startview__title"><span className="wm-green">Nemotron</span> <span className="wm-flow">Voice Agent</span></h1>
        <p className="startview__subtitle">Pick an assistant, choose how it runs, and start a live voice conversation.</p>
        <ol className="startview__steps" aria-label="Session setup">
          <li className={selectedExample ? "is-done" : "is-next"}><span>{selectedExample ? "✓" : "01"}</span> Choose an assistant</li>
          <li><span>02</span> Make it yours <em>optional</em></li>
          <li className={selectedExample ? "is-next" : ""}><span>03</span> Start talking</li>
        </ol>
      </div>

      <div className={`example-grid${showBuilder ? "" : " example-grid--three"}`} data-tour="examples">
        {deploymentOptions.map((option) => {
          const isSelected = selectedExample?.key === option.key;
          const meta = EXAMPLE_META[option.key] ?? FALLBACK_META;
          if (option.variants?.length) {
            const activeId = isSelected ? selectedVariant?.id ?? "" : "";
            const shown = option.variants.find((variant) => variant.id === activeId) ?? option.variants[0];
            return (
              <ExampleCard
                key={option.key}
                option={option}
                selected={isSelected}
                onSelect={() => selectExample(option.key)}
                samples={meta.variantCopy?.[shown.id]?.samples}
                switcher={(
                  <CardSwitch
                    groupId={`${option.key}-modes`}
                    label="Mode"
                    value={activeId}
                    disabled={connecting || configurationLoading}
                    options={option.variants.map((variant) => ({
                      id: variant.id,
                      label: variantCta(meta, variant),
                      title: variant.description || undefined,
                    }))}
                    onPick={(id) => {
                      const variant = option.variants?.find((item) => item.id === id);
                      if (variant) pickVariant(option, variant);
                    }}
                  >
                    {isSelected && needsLanguage ? <SessionLanguagePicker disabled={connecting} talkerKey={selectedVariant?.llm || undefined} /> : undefined}
                  </CardSwitch>
                )}
              />
            );
          }
          return (
            <ExampleCard
              key={option.key}
              option={option}
              selected={isSelected}
              onSelect={() => selectExample(option.key)}
              samples={meta.samples}
              tags={option.key === "generic-frontend-backend-agent" ? meta.tags.filter((tag) => !/Choice of Talker/.test(tag)) : undefined}
              switcher={option.key === "generic-frontend-backend-agent"
                ? <TalkerSwitch option={option} disabled={connecting || configurationLoading} onPick={() => selectExample(option.key)} />
                : meta.feature ? <p className="example-card__feature example-card__slot">{meta.feature}</p> : undefined}
            />
          );
        })}
        {showBuilder && <BuilderCard onBuild={onBuild} disabled={connecting} />}
      </div>

      {connectionError && <p className="startview__error" role="alert">{connectionError}</p>}
     </div>

      {selectedExample && (
        <section className="startview__launch" aria-label="Selected example actions">
          <div className="startview__selection" title={exampleTitle(selectedExample)}>
            <span className="startview__selection-label">Selected</span>
            <strong>{EXAMPLE_META[selectedExample.key]?.shortName ?? exampleTitle(selectedExample)}</strong>
            {selectedVariant && <span className="startview__chip">{selectedVariant.label}</span>}
          </div>
          <div className="startview__customise" role="group" aria-label="Customise before you start">
            <button type="button" className="btn-ghost" data-tour="prompts" onClick={onPrompts} disabled={connecting}>Prompts</button>
            <button type="button" className="btn-ghost" data-tour="tools" onClick={onTools} disabled={connecting}>Tools</button>
            <button type="button" className="btn-ghost" data-tour="voice" onClick={onVoice} disabled={connecting}>Voice</button>
            <button type="button" className="btn-ghost" data-tour="models" onClick={onModels} disabled={connecting}>Models</button>
            {showBuilder && (
              <details className="startview__more" data-tour="save-agent">
                <summary aria-label="More actions" title="More actions">⋯</summary>
                <div className="startview__more-menu">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={connecting}
                    title="Download this configuration as a YAML file"
                    onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); saveAgent(); }}
                  >
                    Save agent (YAML)
                  </button>
                </div>
              </details>
            )}
          </div>
          <button
            type="button"
            className="btn-primary btn-bubbly startview__start"
            data-tour="start"
            onClick={() => requestSession(selectedVariant ? { variant: selectedVariant } : {})}
            disabled={connecting || configurationLoading}
          >
            {connecting ? "Connecting…" : configurationLoading ? "Preparing…" : selectedVariant?.session_language ? `Start in ${selectedVariant.label}` : "Start conversation"}
          </button>
        </section>
      )}



    </div>
  );
}

function ConversationLive({ onLLM }: Readonly<{ onLLM: () => void }>) {
  const { selectedExample, currentSessionId } = useApp();
  const webcam = selectedExample?.capabilities?.includes("webcam") ?? false;
  return (
    <div className="conv-live">
      {currentSessionId && (
        <button
          type="button"
          className="conv-session-id"
          title="Copy session ID (share it if you give feedback)"
          onClick={() => void navigator.clipboard?.writeText(currentSessionId)}
        >
          Session <code>{currentSessionId}</code>
        </button>
      )}
      <div className="conv-live__main">
        <ConversationPanel />
      </div>
      <EventLog />
      {webcam && currentSessionId && (
        <aside className="conv-live__webcam">
          <p className="conv-live__webcam-label">Webcam vision</p>
          <WebcamVisionPanel sessionId={currentSessionId} />
        </aside>
      )}
      <div className="conv-live__dock">
        <MicButton />
        <button type="button" className="btn-secondary llm-trigger llm-trigger--dock" data-tour="llm" onClick={onLLM} title="LLM settings" aria-label="LLM settings"><span aria-hidden="true">☷</span> LLM settings</button>
        <button type="button" className="btn-secondary llm-trigger llm-trigger--dock" data-tour="architecture" onClick={() => requestArchitecture(architectureImageFor(selectedExample?.key))} title="Show the architecture diagram" aria-label="Show architecture"><span aria-hidden="true">◇</span> Show architecture</button>
      </div>
    </div>
  );
}

export function ConversationStage({ onLiveChange, onPrompts, onTools, onVoice, onModels, onBuild, onLLM }: Readonly<{ onLiveChange?: (live: boolean) => void; onLLM: () => void } & SetupNavigation>) {
  const { isConnected, isConnecting } = useConnectionState();
  const { phase } = useSessionLifecycle();
  const live = isConnected && phase === "live";

  useEffect(() => {
    onLiveChange?.(live);
  }, [live, onLiveChange]);
  // Keep the live view mounted through teardown so it doesn't flash back to the
  // landing between disconnect and the thank-you/stopping overlay.
  if (isConnected || phase === "stopping") return <ConversationLive onLLM={onLLM} />;
  return <StartView connecting={isConnecting || phase === "starting"} onPrompts={onPrompts} onTools={onTools} onVoice={onVoice} onModels={onModels} onBuild={onBuild} />;
}
