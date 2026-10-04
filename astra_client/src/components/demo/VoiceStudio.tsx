// SPDX-License-Identifier: BSD-2-Clause
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useApp } from "../../context/useApp";
import { useVoiceCatalog } from "../../api";
import { DEFAULT_SESSION_LANGUAGE } from "../../context/AppContext";
import { useConnectionState } from "../../hooks/useConnectionState";
import { prepareVoiceSample, savedVoiceSample } from "../../demo/voiceSamples";

const VOICE_COLORS = ["#76b900", "#a78bfa", "#38bdf8", "#fb923c", "#f472b6", "#2dd4bf"];

export function VoiceStudio({ onBusyChange }: Readonly<{ onBusyChange: (busy: boolean) => void }>) {
  const app = useApp();
  const { isConnected, isConnecting } = useConnectionState();
  const locked = isConnected || isConnecting;
  const sessionLanguages = app.selectedExample?.capabilities?.includes("session_languages") ?? false;
  const { data: catalog, isLoading, isError, refetch } = useVoiceCatalog(
    app.selectedTTS?.server, app.selectedTTS?.voiceId,
    sessionLanguages ? app.selectedASR?.server : undefined,
    sessionLanguages ? app.selectedASR?.model : undefined,
    sessionLanguages ? app.selectedASR?.functionId : undefined,
    app.selectedTTS?.functionId, app.selectedTTS?.model,
  );
  const [search, setSearch] = useState("");
  const [text, setText] = useState("Hello. This is Nemotron 3 Diarization.");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const supported = /zero.?shot/i.test(app.selectedTTS?.model ?? "");
  const sampleActive = supported && app.useVoiceSample && !!app.voiceSample;
  const voices = catalog?.voices ?? [];
  const defaultVoice = voices.find((voice) => voice.id === app.selectedTTS?.voiceId)
    ?? voices.find((voice) => voice.id === catalog?.defaultVoiceId)
    ?? voices.find((voice) => voice.language.replace("_", "-").toUpperCase() === "EN-US")
    ?? voices[0];
  const language = sessionLanguages ? app.selectedSessionLanguage : defaultVoice?.language;
  const offered = voices.filter((voice) => voice.language.replace("_", "-").toUpperCase() === language?.replace("_", "-").toUpperCase());
  const visibleVoices = offered.filter((voice) => voice.name.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedVoice = offered.find((voice) => voice.id === app.selectedVoiceId)
    ?? offered.find((voice) => voice.id === defaultVoice?.id) ?? offered[0];
  const languages = catalog?.languages;
  const { selectedSessionLanguage, setSelectedSessionLanguage } = app;

  useEffect(() => { onBusyChange(busy || isLoading); }, [busy, isLoading, onBusyChange]);
  useEffect(() => {
    if (!sessionLanguages || !languages?.length || languages.includes(selectedSessionLanguage)) return;
    setSelectedSessionLanguage(languages.includes(DEFAULT_SESSION_LANGUAGE) ? DEFAULT_SESSION_LANGUAGE : languages[0]);
  }, [sessionLanguages, languages, selectedSessionLanguage, setSelectedSessionLanguage]);
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => { if (!preview) return; return () => URL.revokeObjectURL(preview); }, [preview]);

  const sample = async (file: File) => {
    setError(""); setBusy(true); setPreview("");
    try { const voice = await prepareVoiceSample(file); await savedVoiceSample(voice); app.setVoiceSample(voice); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save voice sample."); }
    finally { setBusy(false); }
  };
  const removeSample = async () => {
    setBusy(true); setError(""); setPreview("");
    try { await savedVoiceSample(null); app.setVoiceSample(null); app.setUseVoiceSample(false); }
    catch { setError("Unable to remove the saved sample."); }
    finally { setBusy(false); }
  };
  const synthesize = async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setPreview("");
    try {
      const response = await fetch("/api/tts/preview", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          pipeline_mode: app.selectedExample?.key, tts_id: app.selectedTTSId,
          tts_voice_id: selectedVoice?.id || app.selectedTTS?.voiceId, text,
          ...(/magpie/i.test(app.selectedTTS?.model ?? "") && Object.keys(app.pronunciationOverrides).length ? {tts_pronunciations: app.pronunciationOverrides} : {}),
          ...(sampleActive ? { tts_voice_sample: app.voiceSample!.audio } : {}),
        }) });
      if (!response.ok) { const result = await response.json(); throw new Error(result.detail || "Voice preview failed."); }
      setPreview(URL.createObjectURL(await response.blob()));
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Voice preview failed.");
    } finally { if (request.current === controller) setBusy(false); }
  };

  return <div className="voice-studio">
    {sessionLanguages && <fieldset className="voice-studio__languages" disabled={locked || busy}>
      <legend className="set-field__label">Session language</legend>
      {languages?.map((lang) => <label key={lang} className="ex-tool">
        <input type="radio" name="session-language" checked={app.selectedSessionLanguage === lang}
          onChange={() => { app.setSelectedSessionLanguage(lang); app.setSelectedVoiceId(""); setPreview(""); }} />{lang}
      </label>)}
    </fieldset>}
    <p className="voice-studio__intro">Choose the voice your assistant speaks with. Listen before you start.</p>
    {isLoading && <p role="status" className="set-hint">Loading voices…</p>}
    {isError && <p role="alert" className="ex-config__error">Unable to load voices. <button type="button" className="btn-ghost" onClick={() => void refetch()}>Retry</button></p>}
    {!isLoading && !isError && !offered.length && <p className="set-hint">This engine uses its configured voice. You can preview it below.</p>}
    {offered.length > 6 && <label className="voice-studio__search set-field"><span className="set-field__label">Find a voice <span>{visibleVoices.length} of {offered.length}</span></span>
      <input type="search" className="set-select" value={search} placeholder="Search by name or expression" onChange={(event) => setSearch(event.target.value)} />
    </label>}
    {!!offered.length && !visibleVoices.length && <p role="status" className="set-hint">No matching voices. Try another name or expression.</p>}
    <fieldset className="voice-studio__presets" disabled={locked || busy || sampleActive}>
      <legend className="sr-only">Speaking voice</legend>
      <div className="voice-studio__grid">
        {visibleVoices.map((voice) => <label key={voice.id}
          className={`voice-card ${selectedVoice?.id === voice.id && !sampleActive ? "voice-card--selected" : ""}`}
          style={{ "--voice-accent": VOICE_COLORS[offered.indexOf(voice) % VOICE_COLORS.length] } as CSSProperties}>
          <input type="radio" name="tts-voice" value={voice.id} checked={selectedVoice?.id === voice.id && !sampleActive}
            onChange={() => { app.setSelectedVoiceId(voice.id); setPreview(""); setError(""); }} />
          <span className="voice-card__visual" aria-hidden="true">
            <span className="voice-card__avatar">{voice.name.slice(0, 1).toUpperCase()}</span>
            <svg className="voice-card__wave" viewBox="0 0 80 32" fill="none"><path d="M4 13v6m8-12v18m8-20v22m8-15v8m8-18v28m8-24v20m8-15v10m8-18v26m8-18v10m8-8v6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
          </span>
          <span className="voice-card__name">{voice.name.replaceAll(".", " · ")}</span>
          <span className="voice-card__meta">{voice.language.replace("_", "-")}<span aria-hidden="true">{selectedVoice?.id === voice.id && !sampleActive ? "Selected ✓" : "Choose voice"}</span></span>
        </label>)}
      </div>
    </fieldset>
    {sampleActive && <p role="status" className="set-hint">Your custom sample supplies the voice. Turn it off to choose a preset.</p>}
    <div className="voice-studio__preview">
      <label className="set-field"><span className="set-field__label">Try the selected voice</span>
        <input className="set-select" maxLength={200} disabled={locked || busy} value={text} onChange={(event) => { setText(event.target.value); setPreview(""); }} />
      </label>
      <button type="button" className="btn-secondary voice-studio__play" disabled={busy || locked || isLoading || !app.selectedTTS || !text.trim()}
        onClick={() => void synthesize()}><span aria-hidden="true">▶</span> {busy ? "Preparing audio…" : "Preview voice"}</button>
      {preview && <audio aria-label="Selected voice preview" controls autoPlay src={preview} />}
    </div>
    <section className={`voice-studio__custom ${sampleActive ? "voice-studio__custom--selected" : ""}`} aria-label="Custom voice sample">
      <div className="voice-studio__custom-head"><span className="voice-studio__custom-icon" aria-hidden="true">✦</span><div><h4>Create a character voice</h4><p>Bring your Halloween voice or another original character.</p></div><span className="voice-studio__badge">Zero-shot</span></div>
      <label className="set-field"><span className="set-field__label">Custom voice sample</span>
        <input type="file" accept="audio/*" disabled={busy || locked}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void sample(file); event.target.value = ""; }} />
      </label>
      <p className="set-hint">Upload 3–10 seconds of clear speech. Saved in this browser; sent to your selected speech service when used.</p>
      {app.voiceSample && <div className="voice-studio__sample">
        <span className="voice-studio__filename">{app.voiceSample.name}</span>
        <label><input type="checkbox" checked={app.useVoiceSample} disabled={!supported || locked || busy}
          onChange={(event) => { app.setUseVoiceSample(event.target.checked); setPreview(""); }} /> Use sample for zero-shot voice</label>
        <button type="button" className="btn-ghost" disabled={busy || locked} onClick={() => void removeSample()}>Remove sample</button>
      </div>}
      {!supported && <p className="set-hint">Choose Magpie Zero-shot above to use your custom sample.</p>}
    </section>
    {error && <p role="alert" className="ex-config__error">{error}</p>}
  </div>;
}
