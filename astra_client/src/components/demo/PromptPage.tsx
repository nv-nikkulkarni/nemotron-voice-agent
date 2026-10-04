// SPDX-License-Identifier: BSD-2-Clause
import { useState } from "react";
import { ExpandedPromptEditor } from "./ExpandedPromptEditor";
import { useConnectionState } from "../../hooks/useConnectionState";
import { useApp } from "../../context/useApp";

export function PromptPage({ onClose }: Readonly<{ onClose: () => void }>) {
  const app = useApp();
  const [expanded, setExpanded] = useState<"frontend" | "backend" | null>(null);
  const { isConnected, isConnecting } = useConnectionState();
  const active = isConnected || isConnecting || app.promptsLoading;
  const omni = app.selectedExample?.key === "omni-assistant-subagents";
  const frontendName = omni ? "Speaker" : "frontend";
  const backendName = omni ? "Thinker" : "backend";
  const frontendLabel = omni ? "Speaker system prompt · speech and coordination" : "Frontend system prompt · spoken responses";
  const backendLabel = omni ? "Thinker system prompt · deliberate reasoning" : "Backend system prompt · planning and tools";
  const frontend = app.selectedPrompt?.content ?? "";
  const backend = app.prompts.find((prompt) => prompt.role === "backend")?.content ?? "";
  return (
    <section className="prompt-studio" aria-label="Prompt configuration">
      <div className="prompt-studio__head">
        <div><p className="studio-eyebrow">AGENT INSTRUCTIONS</p><h2>Make the conversation yours.</h2>
          <p className="prompt-studio__example">{app.selectedExample?.label ?? "Voice agent"}</p></div>
        <button className="btn-secondary" onClick={onClose}>Back to setup</button>
      </div>
      <p className="prompt-studio__lead">Prepare your next demo here. Edits are saved in this browser and applied when a new session starts.</p>
      {omni && <p className="set-hint">Speaker and Thinker use the same Nemotron Omni model with separate system prompts.</p>}
      {app.promptsLoading && <p role="status" className="set-hint">Loading system prompt defaults…</p>}
      <div className="prompt-studio__grid">
        <section className="prompt-studio-card" aria-label={omni ? "Speaker instructions" : "Frontend instructions"}>
          <div className="prompt-studio-card__head"><span className="prompt-studio-card__number" aria-hidden="true">01</span><div><h3>{omni ? "Speaker" : "The conversational voice"}</h3><p>{omni ? "Understand speech, coordinate workers, and shape spoken replies." : "Set the tone, personality, and spoken responses."}</p></div>
            <button type="button" className="btn-secondary prompt-studio-card__expand" disabled={active} aria-label={`Expand ${frontendName} editor`} onClick={() => setExpanded("frontend")}>Expand editor <span aria-hidden="true">↗</span></button>
          </div>
          <label className="set-field"><span id="frontend-prompt-label" className="set-field__label">{frontendLabel}</span>
            <textarea disabled={active} className="set-textarea" rows={12} maxLength={32000} aria-labelledby="frontend-prompt-label" value={app.promptOverride || frontend}
              onChange={(event) => app.setPromptOverride(event.target.value === frontend ? "" : event.target.value)} />
          </label>
          <button disabled={active} className="btn-ghost" onClick={() => app.setPromptOverride("")}>Restore {frontendName.toLowerCase()} default</button>
        </section>
        {backend && <section className="prompt-studio-card" aria-label={omni ? "Thinker instructions" : "Backend instructions"}>
          <div className="prompt-studio-card__head"><span className="prompt-studio-card__number" aria-hidden="true">02</span><div><h3>{omni ? "Thinker" : "The planning brain"}</h3><p>{omni ? "Guide deliberate reasoning when a difficult turn is handed off." : "Guide reasoning, decisions, and tool use."}</p></div>
            <button type="button" className="btn-secondary prompt-studio-card__expand" disabled={active} aria-label={`Expand ${backendName} editor`} onClick={() => setExpanded("backend")}>Expand editor <span aria-hidden="true">↗</span></button>
          </div>
          <label className="set-field"><span id="backend-prompt-label" className="set-field__label">{backendLabel}</span>
            <textarea disabled={active} className="set-textarea" rows={12} maxLength={32000} aria-labelledby="backend-prompt-label" value={app.backendPromptOverride || backend}
              onChange={(event) => app.setBackendPromptOverride(event.target.value === backend ? "" : event.target.value)} />
          </label>
          <button disabled={active} className="btn-ghost" onClick={() => app.setBackendPromptOverride("")}>Restore {backendName.toLowerCase()} default</button>
        </section>}
        <section className="prompt-studio-card prompt-studio-card--persistent" aria-label="Persistent instructions">
          <div className="prompt-studio-card__head"><span className="prompt-studio-card__number" aria-hidden="true">+</span><div><h3>Your standing instructions</h3><p>Keep your preferences across prompt edits and demos.</p></div><span className="prompt-studio-card__badge">Always appended</span></div>
          <label className="set-field"><span id="persistent-prompt-label" className="set-field__label">{omni ? "Persistent instructions · appended to Speaker and Thinker prompts" : "Persistent instructions · appended to both prompts"}</span>
            <textarea disabled={active} className="set-textarea" rows={5} maxLength={32000} aria-labelledby="persistent-prompt-label" value={app.persistentPrompt}
              placeholder="Your demo persona, tone, or standing preferences"
              onChange={(event) => app.setPersistentPrompt(event.target.value)} />
          </label>
          <p className="set-hint">Persistent instructions remain when you restore a default prompt. Tool permissions and model roles are configured separately.</p>
        </section>
      </div>
      {expanded && <ExpandedPromptEditor
        role={expanded}
        roleLabel={omni ? expanded === "frontend" ? "Speaker" : "Thinker" : undefined}
        example={app.selectedExample?.label ?? "Voice agent"}
        value={expanded === "frontend" ? app.promptOverride || frontend : app.backendPromptOverride || backend}
        disabled={active}
        onChange={(value) => {
          if (expanded === "frontend") app.setPromptOverride(value === frontend ? "" : value);
          else app.setBackendPromptOverride(value === backend ? "" : value);
        }}
        onRestore={() => {
          if (expanded === "frontend") app.setPromptOverride("");
          else app.setBackendPromptOverride("");
        }}
        onClose={() => setExpanded(null)}
      />}
    </section>
  );
}
