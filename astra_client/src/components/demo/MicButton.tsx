// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Prominent mic mute/unmute control shown during a live conversation.

import { usePipecatClientMicControl } from "@pipecat-ai/client-react";

export function MicButton() {
  const { enableMic, isMicEnabled } = usePipecatClientMicControl();
  return (
    <button
      type="button"
      className={`mic-button ${isMicEnabled ? "on" : "off"}`}
      onClick={() => enableMic(!isMicEnabled)}
      title={isMicEnabled ? "Mute microphone" : "Unmute microphone"}
      aria-pressed={!isMicEnabled}
    >
      <span className="mic-button__icon" aria-hidden>{isMicEnabled ? "🎤" : "🔇"}</span>
      <span className="mic-button__label">{isMicEnabled ? "Mute" : "Unmute"}</span>
    </button>
  );
}
