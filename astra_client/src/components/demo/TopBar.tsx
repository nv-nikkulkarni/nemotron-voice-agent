// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import { useEffect, useState } from "react";
import { useSessionLifecycle } from "../../hooks/useSessionLifecycle";
import { demoConfig } from "../../config";

function deployedAtLabel(value: string): string {
  const deployedAt = new Date(value);
  if (!value || Number.isNaN(deployedAt.getTime())) return "Build time unavailable";
  return `Last deployed ${deployedAt.toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, " UTC")}`;
}

export function TopBar({
  conversationView,
  onHome,
  onSettings,
  onPipeline,
  onTour,
}: Readonly<{
  conversationView: boolean;
  onHome: () => void;
  onSettings: () => void;
  onPipeline: () => void;
  onTour: () => void;
}>) {
  const { phase, endSession } = useSessionLifecycle();
  const [showTourHint, setShowTourHint] = useState(true);
  const active = phase === "starting" || phase === "live" || phase === "stopping";
  const stopping = phase === "stopping";
  useEffect(() => {
    const timer = window.setTimeout(() => setShowTourHint(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);
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
        {!active && showTourHint && (
          <div className="tour-hint" role="status" aria-live="polite">
            Click <strong>?</strong> for a tour
          </div>
        )}
        {!active && (
          <button
            className="icon-btn icon-btn--tour"
            onClick={() => {
              setShowTourHint(false);
              onTour();
            }}
            title="Guided introduction"
            aria-label="Open guided introduction"
          >
            ?
          </button>
        )}
        {conversationView && (phase === "live" || phase === "stopping") && <ConversationUtilities onSettings={onSettings} onPipeline={onPipeline} />}
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

function ConversationUtilities({ onSettings, onPipeline }: Readonly<{onSettings: () => void; onPipeline: () => void}>) {
  const [showHints, setShowHints] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setShowHints(false), 2000);
    return () => window.clearTimeout(timer);
  }, []);
  return <div className="conversation-utilities">
    <button type="button" className="icon-btn" data-tour="pipeline" onClick={() => {setShowHints(false);onPipeline();}} title="Agent configuration" aria-label="Agent configuration">ⓘ</button>
    <button type="button" className="icon-btn icon-btn--settings" data-tour="settings" onClick={() => {setShowHints(false);onSettings();}} title="Audio settings" aria-label="Audio settings">⚙</button>
    {showHints && <div className="conversation-hints" role="status" aria-live="polite">
      <p><span aria-hidden="true">⚙</span> Configure audio devices here</p>
      <p><span aria-hidden="true">ⓘ</span> Check current agent configuration here</p>
    </div>}
  </div>;
}
