// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import { useSessionLifecycle } from "../../hooks/useSessionLifecycle";
import { demoConfig } from "../../config";

function deployedAtLabel(value: string): string {
  const deployedAt = new Date(value);
  if (!value || Number.isNaN(deployedAt.getTime())) return "Build time unavailable";
  return `Last deployed ${deployedAt.toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, " UTC")}`;
}

export function TopBar({ onHome, onSettings, onPipeline }: Readonly<{ onHome: () => void; onSettings: () => void; onPipeline: () => void }>) {
  const { phase, endSession } = useSessionLifecycle();
  const active = phase === "starting" || phase === "live" || phase === "stopping";
  const stopping = phase === "stopping";
  const goHome = () => {
    onHome();                                       // close any settings/pipeline overlay
    if (active && !stopping) void endSession("user"); // end a live session -> graceful teardown
  };
  return (
    <header className="clean-topbar">
      <button type="button" className="clean-brand clean-brand--home" onClick={goHome} title="Back to home" aria-label="Back to home">
        <img className="clean-brand__logo" src="/nvidia-eye.png" alt="NVIDIA" />
        <span className="clean-brand__divider" aria-hidden />
        <span className="clean-brand__product"><span className="wm-green">Nemotron</span> <span className="wm-flow">Voice Agent</span></span>
      </button>
      <time className="clean-deployed-at" dateTime={demoConfig.deployedAt} title="UTC timestamp baked into this UI image">
        {deployedAtLabel(demoConfig.deployedAt)}
      </time>
      <div className="clean-topbar__actions">
        <button className="icon-btn" onClick={onPipeline} title="Pipeline info" aria-label="Pipeline info">ⓘ</button>
        <button className="icon-btn icon-btn--settings" onClick={onSettings} title="Settings" aria-label="Settings">⚙</button>
        {active && (
          <button
            className="btn-secondary btn-bubbly clean-end"
            disabled={stopping}
            onClick={() => void endSession("user")}
          >
            {stopping ? "Ending…" : "End"}
          </button>
        )}
      </div>
    </header>
  );
}
