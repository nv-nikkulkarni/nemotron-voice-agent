// SPDX-License-Identifier: BSD-2-Clause
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { applyLLMSettings, getLLMSettings, type LLMRole, type LLMSettings, type LLMSettingsDocument, type SamplingParameter } from "../../api";
import { useApp } from "../../context/useApp";
import { useSessionLifecycle } from "../../hooks/useSessionLifecycle";
import { cleanLLMSettings, SAMPLING_FIELDS, validSamplingValue } from "../../demo/llmSettings";

const BASIC: SamplingParameter[] = ["temperature", "top_p", "max_tokens"];
const ADVANCED: SamplingParameter[] = ["top_k", "repetition_penalty", "frequency_penalty", "presence_penalty"];
export function LLMSettingsDialog({onClose}: Readonly<{onClose: () => void}>) {
  const app = useApp();
  const {phase} = useSessionLifecycle();
  const live = phase === "live";
  const sessionId = live ? app.currentSessionId : undefined;
  const dialog = useRef<HTMLDialogElement>(null);
  const [document, setDocument] = useState<LLMSettingsDocument | null>(null);
  const [draft, setDraft] = useState<LLMSettings>({});
  const [saved, setSaved] = useState<LLMSettings>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previous = window.document.activeElement;
    element?.showModal();
    return () => {element?.close(); if (previous instanceof HTMLElement) previous.focus();};
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void getLLMSettings(app.selectedExample?.key ?? "", app.selectedLLMId, sessionId, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setDocument(data);
      const validRoles = new Set(data.roles.map(role => role.key));
      const settings = Object.fromEntries(Object.entries(cleanLLMSettings(sessionId ? data.settings : app.llmOverrides)).filter(([key]) => validRoles.has(key)));
      setDraft(settings); setSaved(settings);
    }).catch(reason => {if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load LLM settings.");});
    return () => controller.abort();
  // Load one snapshot when opened; edits stay local until the user applies them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.selectedExample?.key, app.selectedLLMId, sessionId]);
  const invalid = Object.values(draft).some(values => Object.entries(values).some(([key, value]) => !validSamplingValue(key as SamplingParameter, value!)));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const locked = pending || phase === "starting" || phase === "stopping";
  const reset = (role?: string) => {
    setNotice("");
    setDraft(previous => {const next = {...previous}; if (role) delete next[role]; else return {}; return next;});
  };
  const update = (role: string, field: SamplingParameter, value: number) => {
    setNotice("");
    setDraft(previous => ({...previous, [role]: {...previous[role], [field]: value}}));
  };
  const apply = async () => {
    if (!document || locked || invalid) return;
    setPending(true); setError("");
    try {
      if (sessionId) {
        const response = await applyLLMSettings(sessionId, draft, document.revision);
        setDocument(response);
      }
      app.setLLMOverrides(draft); setSaved(draft);
      setNotice(sessionId ? "Applied. Future requests use these settings; the current response continues unchanged." : "Saved for your next conversation.");
    } catch (reason) {setError(reason instanceof Error ? reason.message : "Unable to apply LLM settings.");}
    finally {setPending(false);}
  };
  const field = (role: LLMRole, name: SamplingParameter) => {
    const spec = SAMPLING_FIELDS[name];
    const value = draft[role.key]?.[name] ?? role.defaults[name];
    const valid = validSamplingValue(name, value);
    return <label key={name} className="llm-field">
      <span>{spec.label}</span><input type="number" aria-label={`${role.label} ${spec.label}`} aria-invalid={!valid} min={spec.min} max={spec.max} step="any" inputMode={name === "max_tokens" || name === "top_k" ? "numeric" : "decimal"} value={Number.isNaN(value) ? "" : value} onChange={event => update(role.key, name, event.target.value === "" ? NaN : Number(event.target.value))} />
      <small>{valid ? spec.description : `Enter ${name === "top_k" ? "−1 or an integer from 1 to 1,000" : `a ${name === "max_tokens" ? "whole " : ""}number from ${spec.min} to ${spec.max}`}.`}</small>
    </label>;
  };
  return createPortal(<dialog ref={dialog} className="llm-dialog" aria-labelledby="llm-title" onCancel={event => {event.preventDefault(); if (!pending) onClose();}}>
    <div className="llm-dialog__head"><div><p className="studio-eyebrow">MODEL CONTROLS</p><h2 id="llm-title">LLM settings</h2><p>{app.selectedExample?.label}</p></div><button type="button" className="icon-btn" aria-label="Close LLM settings" disabled={pending} onClick={onClose}>×</button></div>
    <div className="llm-dialog__body">
      <p className="llm-lead">{live ? "Tune each model during your conversation. Apply changes to future requests without restarting." : "Set each model's generation settings before your conversation."}</p>
      {!document && !error && <p role="status">Loading model settings…</p>}
      {document && document.roles.length === 0 && <p>No model controls are available for this example.</p>}
      <fieldset className="llm-roles" disabled={locked}><legend className="sr-only">Model generation settings</legend>
        {document?.roles.map((role, index) => <section key={role.key} className="llm-role" aria-label={`${role.label} settings`}>
          <div className="llm-role__head"><span className="studio-section__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div><h3>{role.label}</h3><p>{role.description}</p><code>{role.model}</code></div><button type="button" className="llm-reset" onClick={() => reset(role.key)}>Reset</button></div>
          <div className="llm-fields">{BASIC.map(name => field(role, name))}</div>
          <details><summary>Advanced sampling</summary><div className="llm-fields llm-fields--advanced">{ADVANCED.map(name => field(role, name))}</div></details>
          {(draft[role.key]?.top_k ?? role.defaults.top_k) === 1 && <p className="llm-note">Top K is 1: token selection is greedy. Increase it or use −1 for temperature and Top P sampling.</p>}
        </section>)}
      </fieldset>
      {error && <p className="llm-error" role="alert">{error}</p>}
      {notice && <p className="llm-success" role="status">{notice}</p>}
    </div>
    <div className="llm-dialog__foot"><button type="button" className="btn-secondary" disabled={!document || locked} onClick={() => reset()}>Reset all</button><span>Saved separately for each assistant</span><button type="button" className="btn-primary btn-bubbly" disabled={!document?.roles.length || locked || invalid || !dirty} onClick={() => void apply()}>{pending ? "Applying…" : live ? "Apply to session" : "Save settings"}</button></div>
  </dialog>, window.document.body);
}
