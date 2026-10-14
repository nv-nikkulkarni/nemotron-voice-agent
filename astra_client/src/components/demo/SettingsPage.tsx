// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Settings contains only microphone and speaker selection.
// Agent configuration belongs to the pre-session launch flow.

import { usePipecatClientMediaDevices } from "@pipecat-ai/client-react";

function DeviceSelect({
  label, devices, selectedId, onChange,
}: Readonly<{ label: string; devices: MediaDeviceInfo[]; selectedId?: string; onChange: (id: string) => void }>) {
  return (
    <label className="set-field">
      <span className="set-field__label">{label}</span>
      <select className="set-select" value={selectedId ?? ""} onChange={(e) => onChange(e.target.value)}>
        {devices.length === 0 && <option value="">No devices found</option>}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label || "Unknown device"}</option>
        ))}
      </select>
    </label>
  );
}

function Section({ icon, title, children }: Readonly<{ icon: string; title: string; children: React.ReactNode }>) {
  return (
    <section className="set-section">
      <h3 className="set-section__title">{icon} {title}</h3>
      {children}
    </section>
  );
}

export function SettingsPage({ onClose }: Readonly<{ onClose: () => void }>) {
  const { availableMics, selectedMic, updateMic, availableSpeakers, selectedSpeaker, updateSpeaker } = usePipecatClientMediaDevices();

  const micId = "deviceId" in selectedMic ? selectedMic.deviceId : undefined;
  const spkId = "deviceId" in selectedSpeaker ? selectedSpeaker.deviceId : undefined;

  return (
    <div className="page-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="page-panel">
        <div className="page-panel__head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">×</button>
        </div>

        <div className="page-panel__body">
          <p className="set-hint">Choose the microphone you speak into and the speaker you hear the assistant through.</p>
          <Section icon="🎧" title="Audio">
            <DeviceSelect label="Input device (microphone)" devices={availableMics} selectedId={micId} onChange={updateMic} />
            <DeviceSelect label="Output device (speaker)" devices={availableSpeakers} selectedId={spkId} onChange={updateSpeaker} />
          </Section>


        </div>

        <div className="page-panel__foot">
          <button className="btn-primary btn-bubbly" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
