// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/unbounded'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/nvidia-theme.scss'
import App from './App.tsx'
import { installMasterAudioTap } from './demo/masterAudioTap'
import { installConnectGuards } from './demo/connectGuards'

// Install the WebAudio output tap before anything creates an AudioContext, so the
// pipecat playback context's connect-to-destination is caught (used to measure the
// client audio-playout tail for the latency breakdown).
installMasterAudioTap()
// Swallow the benign orphaned rejection the WS transport throws when a connect fails
// before begin() ("Session ended: please call .begin() first"); the lifecycle recovers.
installConnectGuards()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
