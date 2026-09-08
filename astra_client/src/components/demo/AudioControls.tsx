// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Audio device + volume controls for a live session: mic (device + mute + input
// gain) and speaker (output device + output volume). Output volume/device are
// applied to the <audio> element(s) PipecatClientAudio renders; mic gain drives
// a Web Audio GainNode on the local track.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePipecatClientMicControl, usePipecatClientMediaDevices, usePipecatClientMediaTrack } from "@pipecat-ai/client-react";

/** Apply a volume (0..1) to every bot <audio> element, keeping it applied as they change. */
function useOutputVolume(volume: number) {
  useEffect(() => {
    const apply = () => document.querySelectorAll("audio").forEach((a) => { a.volume = volume; });
    apply();
    const id = window.setInterval(apply, 1500); // PipecatClientAudio may recreate elements
    return () => window.clearInterval(id);
  }, [volume]);
}

/** Web Audio gain on the local mic track — drives the send level where the transport allows. */
function useInputGain(track: MediaStreamTrack | null, gain: number) {
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  useEffect(() => {
    if (!track) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = ctxRef.current ?? new Ctor();
    ctxRef.current = ctx;
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const g = ctx.createGain();
    g.gain.value = gain;
    gainRef.current = g;
    const dest = ctx.createMediaStreamDestination();
    src.connect(g).connect(dest);
    return () => { try { src.disconnect(); g.disconnect(); } catch { /* gone */ } };
  }, [track]);
  useEffect(() => { if (gainRef.current) gainRef.current.gain.value = gain; }, [gain]);
  useEffect(() => () => { ctxRef.current?.close().catch(() => undefined); }, []);
}

function DevicePicker({
  label, icon, devices, selectedId, onSelect,
}: Readonly<{ label: string; icon: string; devices: MediaDeviceInfo[]; selectedId?: string; onSelect: (id: string) => void }>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="ac-picker" ref={ref}>
      <button className="ac-picker__btn" onClick={() => setOpen((v) => !v)} title={`Select ${label}`}>
        <span className="chevron">▾</span>
      </button>
      {open && (
        <div className="ac-menu">
          <p className="ac-menu__label">{icon} {label}</p>
          {devices.length === 0 && <p className="ac-menu__empty">No devices</p>}
          {devices.map((d) => (
            <button key={d.deviceId} className={`ac-menu__item ${selectedId === d.deviceId ? "on" : ""}`} onClick={() => { onSelect(d.deviceId); setOpen(false); }}>
              {selectedId === d.deviceId && <span className="ac-check">✓</span>}
              {d.label || "Unknown device"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AudioControls() {
  const { enableMic, isMicEnabled } = usePipecatClientMicControl();
  const { availableMics, selectedMic, updateMic, availableSpeakers, selectedSpeaker, updateSpeaker } = usePipecatClientMediaDevices();
  const localTrack = usePipecatClientMediaTrack("audio", "local");

  const [inputGain, setInputGain] = useState(1);
  const [outputVol, setOutputVol] = useState(1);

  useOutputVolume(outputVol);
  useInputGain(localTrack, inputGain);

  const micDeviceId = "deviceId" in selectedMic ? selectedMic.deviceId : undefined;
  const spkDeviceId = "deviceId" in selectedSpeaker ? selectedSpeaker.deviceId : undefined;
  const toggleMic = useCallback(() => enableMic(!isMicEnabled), [enableMic, isMicEnabled]);

  return (
    <div className="audio-controls">
      {/* Mic group */}
      <div className="ac-group">
        <button
          className={`ac-btn ac-btn--bubbly ${isMicEnabled ? "on" : "off"}`}
          onClick={toggleMic}
          title={isMicEnabled ? "Mute mic" : "Unmute mic"}
        >
          <span className="ac-btn__icon">{isMicEnabled ? "🎤" : "🔇"}</span>
        </button>
        <DevicePicker label="Microphone" icon="🎤" devices={availableMics} selectedId={micDeviceId} onSelect={updateMic} />
        <label className="ac-slider" title="Input volume (mic gain)">
          <span className="ac-slider__icon">🎚️</span>
          <input type="range" min={0} max={2} step={0.05} value={inputGain} onChange={(e) => setInputGain(Number(e.target.value))} />
          <span className="ac-slider__val">{Math.round(inputGain * 100)}%</span>
        </label>
      </div>

      <div className="ac-divider" />

      {/* Speaker group */}
      <div className="ac-group">
        <button
          className={`ac-btn ac-btn--bubbly ${outputVol > 0 ? "on" : "off"}`}
          onClick={() => setOutputVol((v) => (v > 0 ? 0 : 1))}
          title={outputVol > 0 ? "Mute output" : "Unmute output"}
        >
          <span className="ac-btn__icon">{outputVol > 0 ? "🔊" : "🔈"}</span>
        </button>
        <DevicePicker label="Speaker" icon="🔊" devices={availableSpeakers} selectedId={spkDeviceId} onSelect={updateSpeaker} />
        <label className="ac-slider" title="Output volume">
          <span className="ac-slider__icon">🔉</span>
          <input type="range" min={0} max={1} step={0.05} value={outputVol} onChange={(e) => setOutputVol(Number(e.target.value))} />
          <span className="ac-slider__val">{Math.round(outputVol * 100)}%</span>
        </label>
      </div>
    </div>
  );
}
