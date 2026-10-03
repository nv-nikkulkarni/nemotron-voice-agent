// SPDX-License-Identifier: BSD-2-Clause
import { useConnectionState } from "../../hooks/useConnectionState";
import { useApp } from "../../context/useApp";

export function PromptPage({ onClose }: Readonly<{ onClose: () => void }>) {
  const app = useApp();
  const { isConnected, isConnecting } = useConnectionState();
  const active = isConnected || isConnecting || app.promptsLoading;
  const frontend = app.selectedPrompt?.content ?? "";
  const backend = app.prompts.find((prompt) => prompt.role === "backend")?.content ?? "";
  return (
    <section className="prompt-studio" aria-label="Prompt configuration">
      <div className="page-panel__head"><h2>Prompts · {app.selectedExample?.label ?? "Voice agent"}</h2>
        <button className="btn-secondary" onClick={onClose}>Back to setup</button></div>
      <p className="set-hint">Prepare your next demo here. Edits are saved in this browser and applied when a new session starts.</p>
      {app.promptsLoading && <p role="status" className="set-hint">Loading system prompt defaults…</p>}
      <label className="set-field"><span className="set-field__label">Frontend system prompt · spoken responses</span>
        <textarea disabled={active} className="set-textarea" rows={12} maxLength={32000} value={app.promptOverride || frontend}
          onChange={(event) => app.setPromptOverride(event.target.value === frontend ? "" : event.target.value)} />
      </label>
      <button disabled={active} className="btn-ghost" onClick={() => app.setPromptOverride("")}>Restore frontend default</button>
      {backend && <><label className="set-field"><span className="set-field__label">Backend system prompt · planning and tools</span>
        <textarea disabled={active} className="set-textarea" rows={12} maxLength={32000} value={app.backendPromptOverride || backend}
          onChange={(event) => app.setBackendPromptOverride(event.target.value === backend ? "" : event.target.value)} />
        </label><button disabled={active} className="btn-ghost" onClick={() => app.setBackendPromptOverride("")}>Restore backend default</button></>}
      <label className="set-field"><span className="set-field__label">Persistent instructions · appended to both prompts</span>
        <textarea disabled={active} className="set-textarea" rows={5} maxLength={32000} value={app.persistentPrompt}
          placeholder="Your demo persona, tone, or standing preferences"
          onChange={(event) => app.setPersistentPrompt(event.target.value)} />
      </label>
      <p className="set-hint">Persistent instructions remain when you restore a default prompt. Tool permissions and model roles are configured separately.</p>
    </section>
  );
}
