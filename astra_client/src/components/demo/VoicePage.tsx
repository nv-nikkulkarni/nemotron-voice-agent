// SPDX-License-Identifier: BSD-2-Clause
import { useState } from "react";
import { useApp } from "../../context/useApp";
import { useConnectionState } from "../../hooks/useConnectionState";
import { VoiceStudio } from "./VoiceStudio";
import { PronunciationEditor } from "./PronunciationEditor";

export function VoicePage({ onClose }: Readonly<{ onClose: () => void }>) {
  const app = useApp();
  const { isConnected, isConnecting } = useConnectionState();
  const [busy, setBusy] = useState(false);
  const locked = isConnected || isConnecting;
  return <section className="agent-studio agent-studio--voice" aria-label="Voice studio">
    <header className="agent-studio__head">
      <div><p className="studio-eyebrow">VOICE STUDIO</p><h2>Give your agent a voice.</h2><p>{app.selectedExample?.label ?? "Voice agent"}</p></div>
      <button type="button" className="btn-secondary" onClick={onClose}>Back to setup</button>
    </header>
    <p className="agent-studio__lead">Choose a voice, create a character, and fine-tune pronunciation. Listen before your next conversation.</p>
    {locked && <p role="status" className="set-hint">Voice configuration is locked during a conversation.</p>}
    <section className="studio-section" aria-labelledby="speech-engine-heading">
      <div className="studio-section__head"><span className="studio-section__number" aria-hidden="true">01</span><div><h3 id="speech-engine-heading">Speech engine</h3><p>Choose how your agent creates speech.</p></div></div>
      {app.ttsLoading && <p role="status">Loading speech engines…</p>}
      <fieldset className="speech-engines" disabled={locked || busy || app.ttsLoading}>
        <legend className="sr-only">Speech engine</legend>
        {app.ttsServices.map(service => <label key={service.id} className={`speech-engine ${app.selectedTTSId === service.id ? "speech-engine--selected" : ""}`}>
          <input type="radio" name="tts-engine" checked={app.selectedTTSId === service.id} onChange={() => app.selectTTS(service.id)} />
          <span className="speech-engine__symbol" aria-hidden="true">{/zero.?shot/i.test(service.model ?? "") ? "✦" : /chatterbox/i.test(service.model ?? "") ? "◈" : "〰"}</span>
          <span><strong>{service.name}</strong><small>{/zero.?shot/i.test(service.model ?? "") ? "Create a voice from your own sample" : /chatterbox/i.test(service.model ?? "") ? "Expressive multilingual speech" : "Natural voices with IPA pronunciation control"}</small></span>
          <span className="speech-engine__state" aria-hidden="true">{app.selectedTTSId === service.id ? "Selected ✓" : "Select"}</span>
        </label>)}
      </fieldset>
      {!app.ttsLoading && !app.ttsServices.length && <p className="set-hint">This example has no configurable speech engine.</p>}
    </section>
    {!!app.ttsServices.length && <section className="studio-section" aria-labelledby="speaking-voice-heading">
      <div className="studio-section__head"><span className="studio-section__number" aria-hidden="true">02</span><div><h3 id="speaking-voice-heading">Speaking voice</h3><p>Explore presets or bring your own character.</p></div></div>
      <VoiceStudio key={app.selectedTTSId} onBusyChange={setBusy} />
    </section>}
    {!!app.ttsServices.length && <PronunciationEditor busy={busy} />}
  </section>;
}
