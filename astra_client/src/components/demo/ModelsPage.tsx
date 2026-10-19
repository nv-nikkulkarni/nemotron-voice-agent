// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Models: choose the frontend (Talker) and backend (Thinker) models from the LLMs this
// deployment serves. Defaults are the example's own models; a choice applies to the next session.

import { useApp } from "../../context/useApp";
import { useConnectionState } from "../../hooks/useConnectionState";
import { useThinkerLLMs } from "../../api";
import { setModelChoice, useAgentStore } from "../../demo/agentConfig";

interface Option { id: string; name: string; note?: string }

function ModelChoices({ legend, options, value, defaultId, disabled, onChange }: Readonly<{
  legend: string; options: Option[]; value: string; defaultId: string; disabled: boolean; onChange: (id: string) => void;
}>) {
  return (
    <fieldset className="models__choices" disabled={disabled}>
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label key={option.id} className={`models__choice ${value === option.id ? "is-selected" : ""}`}>
          <input type="radio" name={legend} checked={value === option.id} onChange={() => onChange(option.id)} />
          <span className="models__choice-body">
            <strong>{option.name}{option.id === defaultId && <em className="models__badge">Default</em>}</strong>
            {option.note && <small>{option.note}</small>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function ModelsPage({ onClose }: Readonly<{ onClose: () => void }>) {
  const app = useApp();
  const { isConnected, isConnecting } = useConnectionState();
  const store = useAgentStore();
  const example = app.selectedExample;
  const key = example?.key ?? "";
  const locked = isConnected || isConnecting;
  const { data: thinkers = [] } = useThinkerLLMs(key);
  const choice = store.modelChoices[key] ?? {};
  const defaultTalker = String((example?.defaults?.llm?.[0] as { id?: string } | undefined)?.id ?? "");
  const defaultBackend = String((example?.defaults?.["thinker-llm"]?.[0] as { id?: string } | undefined)?.id ?? thinkers[0]?.id ?? "");
  const talkers = app.llms.filter((llm) => llm.builtIn);
  const talker = choice.talker ?? defaultTalker;
  const backend = choice.backend ?? defaultBackend;
  const hasBackendChoice = thinkers.length > 1;
  const customised = Boolean(choice.talker || choice.backend);

  return (
    <section className="agent-studio models" aria-label="Model configuration">
      <header className="agent-studio__head">
        <div><p className="studio-eyebrow">MODELS</p><h2>Choose the models behind your agent.</h2><p>{example?.label ?? "Voice agent"}</p></div>
        <button type="button" className="btn-secondary" onClick={onClose}>Back to setup</button>
      </header>
      <p className="agent-studio__lead">Pick from the models this deployment serves. Your choice applies to the next conversation.</p>

      <section className="studio-section">
        <div className="studio-section__head"><span className="studio-section__number" aria-hidden="true">❝</span><div><h3>Frontend · the voice</h3><p>Speaks with you and decides when to hand work to the backend.</p></div></div>
        {talkers.length === 0
          ? <p className="set-hint" role="status">{app.llmsLoading ? "Loading models…" : "This example uses one fixed model."}</p>
          : <ModelChoices
            legend="Frontend model" disabled={locked}
            options={talkers.map((llm) => ({ id: llm.id, name: llm.name, note: llm.supportedLanguages?.length ? `Speaks ${llm.supportedLanguages.join(", ")}` : undefined }))}
            value={talker} defaultId={defaultTalker}
            onChange={(id) => setModelChoice(key, { ...choice, talker: id === defaultTalker ? undefined : id })}
          />}
      </section>

      {thinkers.length > 0 && (
        <section className="studio-section">
          <div className="studio-section__head"><span className="studio-section__number" aria-hidden="true">◈</span><div><h3>Backend · the planner</h3><p>Reasons about requests and plans the tools to use.</p></div></div>
          {hasBackendChoice
            ? <ModelChoices
              legend="Backend model" disabled={locked}
              options={thinkers} value={backend} defaultId={defaultBackend}
              onChange={(id) => setModelChoice(key, { ...choice, backend: id === defaultBackend ? undefined : id })}
            />
            : <p className="set-hint">{thinkers[0]?.name} is the only backend model this example offers.</p>}
        </section>
      )}

      <div className="models__footer">
        <p className="set-hint">A frontend model that does not speak a fixed-language assistant’s language is skipped for that launch.</p>
        <button type="button" className="btn-secondary" disabled={locked || !customised} onClick={() => setModelChoice(key, {})}>Restore defaults</button>
      </div>
    </section>
  );
}
