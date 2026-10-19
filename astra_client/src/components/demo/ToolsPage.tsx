// SPDX-License-Identifier: BSD-2-Clause
import { useApp } from "../../context/useApp";
import { useConnectionState } from "../../hooks/useConnectionState";
import { ToolSelector } from "./ToolSelector";
import { useThinkerLLMs } from "../../api";
import { useAgentStore } from "../../demo/agentConfig";

export function ToolsPage({ onClose, onLLM }: Readonly<{ onClose: () => void; onLLM: () => void }>) {
  const app = useApp();
  const { isConnected, isConnecting } = useConnectionState();
  const locked = isConnected || isConnecting;
  const store = useAgentStore();
  const { data: thinkers = [] } = useThinkerLLMs(app.selectedExample?.key ?? "");
  const choice = store.modelChoices[app.selectedExample?.key ?? ""] ?? {};
  const talkerName = app.llms.find((llm) => llm.id === choice.talker)?.name ?? app.selectedLLM?.name ?? "The frontend model";
  const defaultBackendId = String((app.selectedExample?.defaults?.["thinker-llm"]?.[0] as { id?: string } | undefined)?.id ?? "");
  const backendName = thinkers.find((model) => model.id === (choice.backend ?? defaultBackendId))?.name ?? thinkers[0]?.name ?? "The backend model";
  const generic = app.selectedExample?.domainProfile === "generic" || app.selectedExample?.key === "generic-frontend-backend-agent";
  return <section className="agent-studio agent-studio--tools" aria-label="Tool configuration">
    <header className="agent-studio__head">
      <div><p className="studio-eyebrow">TOOLS & CAPABILITIES</p><h2>Choose what your agent can do.</h2><p>{app.selectedExample?.label ?? "Voice agent"}</p></div>
      <button type="button" className="btn-secondary" onClick={onClose}>Back to setup</button>
    </header>
    <p className="agent-studio__lead">Set the tools available to your next conversation. Each change applies before the session starts.</p>
    <section className="studio-section">
      <div className="studio-section__head"><span className="studio-section__number" aria-hidden="true">⚙</span><div><h3>Agent tools</h3><p>Enable the capabilities you want to use.</p></div></div>
      <fieldset disabled={locked}><legend className="sr-only">Agent tools</legend>
        <ToolSelector tools={app.tools} selectedTools={app.selectedTools} loading={app.toolsLoading} onToggle={app.toggleTool} />
      </fieldset>
    </section>
    <section className="studio-section">
      <div className="studio-section__head"><span className="studio-section__number" aria-hidden="true">◈</span><div><h3>Agent model roles</h3><p>{generic ? "A fast conversational voice with a reasoning planner behind its tools." : "A multimodal agent for speech, images, and video."}</p></div></div>
      <button type="button" className="btn-secondary llm-setup-trigger" disabled={locked} onClick={onLLM}>LLM settings</button>
      {generic ? <div className="agent-roles"><div><strong>{talkerName}</strong><span>Frontend · fast responses · reasoning off</span></div><div><strong>{backendName}</strong><span>Backend · grounded planning · reasoning on</span></div></div>
        : <label className="studio-toggle"><input type="checkbox" disabled={locked || app.llmsLoading} checked={app.reasoning} onChange={event => app.setReasoning(event.target.checked)} /><span>Reasoning<small>Think before answering. Off by default; enabling it adds several seconds before speech starts.</small></span></label>}
    </section>
    {generic && <section className="studio-section">
      <div className="studio-section__head"><span className="studio-section__number" aria-hidden="true">⟲</span><div><h3>Conversation context</h3><p>Give the backend recent exchanges to understand follow-up requests.</p></div></div>
      <div className="backend-history-control">
        <div className="backend-history-control__row"><span id="backend-history-label">Backend history</span><output className="backend-history-control__value" aria-live="polite">{app.backendHistoryTurnLimit} {app.backendHistoryTurnLimit === 1 ? "turn" : "turns"}</output></div>
        <input type="range" aria-label="Backend history turns" min={1} max={app.selectedExample?.backendHistory?.maxTurnLimit ?? 20} step={1} disabled={locked || !app.selectedExample?.backendHistory} value={app.backendHistoryTurnLimit} onChange={event => app.setBackendHistoryTurnLimit(Number(event.target.value))} />
        <small>{app.backendHistoryTurnLimit} user {app.backendHistoryTurnLimit === 1 ? "turn" : "turns"}, including the current request and associated replies. Applies to your next conversation.</small>
        <p className="set-hint">Only this session’s conversation is shared. Long histories use a bounded size budget.</p>
      </div>
    </section>}
  </section>;
}
