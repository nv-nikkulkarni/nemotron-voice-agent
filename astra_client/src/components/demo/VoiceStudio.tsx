// SPDX-License-Identifier: BSD-2-Clause
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../context/useApp";
import { VoiceSettings } from "../VoiceSettings";
import { useConnectionState } from "../../hooks/useConnectionState";
import { prepareVoiceSample, savedVoiceSample } from "../../demo/voiceSamples";

export function VoiceStudio() {
  const app = useApp();
  const { isConnected, isConnecting } = useConnectionState();
  const [text, setText] = useState("Hello. This is Nemotron 3 Diarization.");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const supported = /zero.?shot/i.test(app.selectedTTS?.model ?? "");
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => { if (!preview) return; return () => URL.revokeObjectURL(preview); }, [preview]);
  const sample = async (file: File) => {
    setError(""); setBusy(true);
    try { const voice = await prepareVoiceSample(file); await savedVoiceSample(voice); app.setVoiceSample(voice); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save voice sample."); }
    finally { setBusy(false); }
  };
  const synthesize = async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setPreview("");
    try {
      const response = await fetch("/api/tts/preview", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          pipeline_mode: app.selectedExample?.key, tts_id: app.selectedTTSId,
          tts_voice_id: app.selectedVoiceId || app.selectedTTS?.voiceId, text,
          ...(supported && app.useVoiceSample && app.voiceSample ? { tts_voice_sample: app.voiceSample.audio } : {}),
        }) });
      if (!response.ok) { const result = await response.json(); throw new Error(result.detail || "Voice preview failed."); }
      setPreview(URL.createObjectURL(await response.blob()));
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Voice preview failed.");
    } finally { if (request.current === controller) setBusy(false); }
  };
  return <div className="voice-studio">
    <VoiceSettings />
    <label className="set-field"><span className="set-field__label">Try the selected voice</span>
      <input className="set-select" maxLength={200} value={text} onChange={(event) => setText(event.target.value)} />
    </label>
    <button type="button" className="btn-secondary" disabled={busy || isConnected || isConnecting || !text.trim()}
      onClick={() => void synthesize()}>{busy ? "Preparing audio…" : "Preview voice"}</button>
    {preview && <audio controls autoPlay src={preview} />}
    <label className="set-field"><span className="set-field__label">Custom voice sample</span>
      <input type="file" accept="audio/*" disabled={busy || isConnected || isConnecting}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void sample(file); event.target.value = ""; }} />
    </label>
    <p className="set-hint">Upload 3–10 seconds of clear speech, including your Halloween character voice. The sample is saved in this browser; when used it is sent to your selected speech service.</p>
    {app.voiceSample && <div>
      <span>{app.voiceSample.name}</span>
      <label><input type="checkbox" checked={app.useVoiceSample} disabled={!supported || isConnected || isConnecting}
        onChange={(event) => app.setUseVoiceSample(event.target.checked)} /> Use sample for zero-shot voice</label>
      <button className="btn-ghost" disabled={busy || isConnected} onClick={() => {
        void savedVoiceSample(null).then(() => { app.setVoiceSample(null); app.setUseVoiceSample(false); }).catch(() => setError("Unable to remove the saved sample."));
      }}>Remove sample</button>
    </div>}
    {!supported && <p className="set-hint">Select Magpie Zero-shot to use a custom sample.</p>}
    {error && <p role="alert" className="ex-config__error">{error}</p>}
  </div>;
}
