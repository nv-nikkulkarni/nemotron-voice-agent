// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Build your own agent: a guardrailed chat describes the agent, a live schematic shows it
// taking shape, and the result can be saved as a YAML file, loaded back, or started.

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useApp } from "../../context/useApp";
import { useConnectionState } from "../../hooks/useConnectionState";
import { useSessionLifecycle } from "../../hooks/useSessionLifecycle";
import {
  CUSTOM_BASE_EXAMPLE, MAX_AGENT_FILE_BYTES, agentFileName, builderApi, downloadText, dumpAgentConfig, parseAgentConfig,
  setCustomAgent, useAgentStore, type BuilderCatalog, type BuilderState,
} from "../../demo/agentConfig";
import { languageName } from "../../demo/language";
import { AgentSchematic } from "./AgentSchematic";

interface Message { role: "user" | "assistant"; text: string; declined?: boolean }

const MAX_MESSAGE = 500;
const SUGGESTIONS = [
  "A friendly travel guide for India that speaks Hindi",
  "A calm bedtime story narrator who speaks German and uses no tools",
  "A concise market-and-weather briefing assistant",
];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function BuilderPage({ onClose }: Readonly<{ onClose: () => void }>) {
  const app = useApp();
  const { customAgent } = useAgentStore();
  const { requestSession } = useSessionLifecycle();
  const { isConnected, isConnecting } = useConnectionState();
  const [sessionId, setSessionId] = useState("");
  const [catalog, setCatalog] = useState<BuilderCatalog | null>(null);
  const [state, setState] = useState<BuilderState | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const locked = isConnected || isConnecting;

  useEffect(() => {
    let cancelled = false;
    builderApi.start().then((session) => {
      if (cancelled) return;
      setSessionId(session.session_id);
      setCatalog(session.catalog);
      setState(session);
      setMessages([{ role: "assistant", text: session.reply }]);
      setError("");
    }).catch((failure: unknown) => { if (!cancelled) setError(messageOf(failure)); });
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "nearest" }); }, [messages, busy]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busy || !sessionId) return;
    setInput("");
    setError("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", text: message }]);
    try {
      const turn = await builderApi.turn(sessionId, message);
      setState(turn);
      setMessages((current) => [...current, { role: "assistant", text: turn.reply, declined: turn.intent === "off_topic" || turn.intent === "refused" }]);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }, [busy, sessionId]);

  const submit = (event: FormEvent) => { event.preventDefault(); void send(input); };

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !sessionId || busy) return;
    setError("");
    setBusy(true);
    try {
      if (file.size > MAX_AGENT_FILE_BYTES) throw new Error("That file is too large to be an agent configuration.");
      const check = await builderApi.load(sessionId, parseAgentConfig(await file.text()));
      if (check.errors.length) throw new Error(check.errors.join(" "));
      setState(check);
      const notes = check.warnings.length ? ` ${check.warnings.join(" ")}` : "";
      setMessages((current) => [...current, { role: "assistant", text: `Loaded ${file.name}.${notes} Tell me what to change, or start the agent.` }]);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  // The last started agent is kept in this browser; loading it re-checks it with the builder.
  const resume = async () => {
    if (!customAgent || !sessionId || busy) return;
    setError("");
    setBusy(true);
    try {
      const check = await builderApi.load(sessionId, customAgent.config);
      if (check.errors.length) throw new Error(check.errors.join(" "));
      setState(check);
      setMessages((current) => [...current, { role: "assistant", text: "Resumed your last agent. Tell me what to change, or start it." }]);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!state) return;
    downloadText(agentFileName(state.draft_config), dumpAgentConfig(state.draft_config));
  };

  const start = async () => {
    if (!state || busy) return;
    setBusy(true);
    setError("");
    try {
      const check = await builderApi.validate(state.draft_config);
      if (check.errors.length || !check.session_config) throw new Error(check.errors.join(" ") || "The agent is not ready to start yet.");
      setCustomAgent({ config: check.draft_config, sessionConfig: check.session_config });
      app.selectExample(CUSTOM_BASE_EXAMPLE);
      onClose();
      requestSession({ custom: check.session_config });
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const draft = state?.draft_config;
  const ready = Boolean(state?.ready);
  const voice = draft ? catalog?.voices.find((item) => item.id === draft.speech.voice)?.name : "";

  return (
    <section className="agent-studio agent-builder" aria-label="Build your own agent">
      <header className="agent-studio__head">
        <div><p className="studio-eyebrow">BUILD YOUR OWN</p><h2>Describe it. Watch it take shape.</h2><p>Custom voice agent</p></div>
        <button type="button" className="btn-secondary" onClick={onClose}>Back to setup</button>
      </header>
      <p className="agent-studio__lead">
        Tell the builder what your agent is for. It can set the persona, language, models, voice, and tools from what this deployment offers.
        It only talks about building your agent.
      </p>

      <div className="agent-builder__grid">
        <section className="agent-builder__chat studio-section" aria-label="Builder chat">
          <div className="agent-builder__log" role="log" aria-live="polite" aria-relevant="additions">
            {messages.map((message, index) => (
              <div key={`${index}-${message.role}`} className={`agent-builder__bubble agent-builder__bubble--${message.role} ${message.declined ? "is-declined" : ""}`}>
                {message.text}
              </div>
            ))}
            {busy && <div className="agent-builder__bubble agent-builder__bubble--assistant agent-builder__typing" role="status" aria-label="The builder is working"><span /><span /><span /></div>}
            <div ref={endRef} />
          </div>
          {messages.length <= 1 && !error && (
            <div className="agent-builder__suggestions" aria-label="Examples to start from">
              {SUGGESTIONS.map((text) => (
                <button key={text} type="button" className="agent-builder__suggestion" disabled={busy || !sessionId} onClick={() => void send(text)}>{text}</button>
              ))}
            </div>
          )}
          {error && (
            <p className="agent-builder__error" role="alert">
              {error}
              {!sessionId && <button type="button" className="btn-ghost" onClick={() => setAttempt((count) => count + 1)}>Try again</button>}
            </p>
          )}
          <form className="agent-builder__form" onSubmit={submit}>
            <label className="sr-only" htmlFor="builder-input">Message to the builder</label>
            <textarea
              id="builder-input" className="set-textarea" rows={2} maxLength={MAX_MESSAGE} value={input} disabled={busy || !sessionId || locked}
              placeholder="e.g. A friendly Hindi travel guide named Aarav"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(input); } }}
            />
            <div className="agent-builder__form-row">
              <small>{input.length}/{MAX_MESSAGE}</small>
              <button type="submit" className="btn-primary" disabled={busy || !sessionId || locked || !input.trim()}>Send</button>
            </div>
          </form>
        </section>

        <section className="agent-builder__preview studio-section" aria-label="Your agent so far">
          {draft ? <AgentSchematic config={draft} catalog={catalog} busy={busy} /> : <p className="set-hint" role="status">Starting the builder…</p>}
          {draft && (
            <dl className="agent-builder__facts">
              <div><dt>Language</dt><dd>{languageName(draft.language)}</dd></div>
              <div><dt>Voice</dt><dd>{voice || "Default for the language"}</dd></div>
              <div><dt>Style</dt><dd>{draft.persona.tone}</dd></div>
              {draft.persona.always.length > 0 && <div><dt>Always</dt><dd>{draft.persona.always.join("; ")}</dd></div>}
              {draft.persona.never.length > 0 && <div><dt>Never</dt><dd>{draft.persona.never.join("; ")}</dd></div>}
            </dl>
          )}
          {state && state.warnings.length > 0 && (
            <ul className="agent-builder__warnings" aria-label="Notes about your agent">
              {state.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
          <div className="agent-builder__actions">
            <button type="button" className="btn-primary btn-bubbly" disabled={!ready || busy || locked} onClick={() => void start()}>
              {ready ? "Start your agent" : "Describe your agent to start"}
            </button>
            <button type="button" className="btn-secondary" disabled={!draft} onClick={save}>Save as YAML</button>
            <button type="button" className="btn-secondary" disabled={!sessionId || busy} onClick={() => fileRef.current?.click()}>Load YAML</button>
            {customAgent && messages.length <= 1 && (
              <button type="button" className="btn-secondary" disabled={!sessionId || busy} onClick={() => void resume()}>Resume last agent</button>
            )}
            <input ref={fileRef} type="file" accept=".yaml,.yml,.json" className="sr-only" tabIndex={-1} aria-label="Load an agent file" onChange={(event) => void loadFile(event)} />
          </div>
        </section>
      </div>
    </section>
  );
}
