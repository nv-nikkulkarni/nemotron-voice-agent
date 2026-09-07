// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// The main page body: pick an example + record choice + Start (idle), or the
// live orb + transcript (connected). Nothing else — settings/pipeline-info live
// on their own pages.

import { useState } from "react";
import { useConnectionState } from "../../hooks/useConnectionState";
import { useSessionLifecycle } from "../../hooks/useSessionLifecycle";
import { useApp } from "../../context/useApp";
import type { DeploymentOption } from "../../api";
import { ConversationPanel } from "../content/ConversationPanel";
import { WebcamVisionPanel } from "../WebcamVisionPanel";
import { MicButton } from "./MicButton";
import { ExampleConfigModal } from "./ExampleConfigModal";

interface ExampleMeta {
  accent: string;
  blurb: string;
  tags: string[];
  titleLines?: string[];
  samples?: string[];
  feature?: string;
  beta?: boolean;
}

const EXAMPLE_META: Record<string, ExampleMeta> = {
  "generic-frontend-backend-agent": {
    accent: "#76b900",
    titleLines: ["Generic Frontend/Backend", "Assistant"],
    blurb: "A fast Lightning conversational agent backed by a reasoning Super agent for grounded live tools and reliable answers.",
    tags: ["⚡ Lightning Talker", "🧠 Super Thinker", "🔊 Text-to-speech", "🛠️ Grounded tools"],
    samples: [
      "What's the weather in Tokyo?",
      "What's NVIDIA's current stock price?",
      "What's my BMI if I'm 70 kilos and 1.75 meters?",
    ],
  },
  "omni-assistant-subagents": {
    accent: "#8b5cf6",
    beta: true,
    titleLines: ["Nemotron Omni Assistant", "Subagents"],
    blurb: "A single multimodal Omni model that listens and talks end-to-end, with webcam vision and media understanding.",
    tags: ["🗣️ Omni model", "📷 Webcam vision", "🖼️ Media"],
    feature: "📷 Turn on your webcam or 🖼️ upload an image or video — Omni can see it and talk about it live.",
    samples: [
      "What do you see on my camera?",
      "Tell me a short story about a robot",
      "What's seventeen times twenty three?",
    ],
  },
};

const FALLBACK_META: ExampleMeta = { accent: "#76b900", blurb: "", tags: [] };

function ExampleCard({
  option, selected, onSelect, onConfigure,
}: Readonly<{
  option: DeploymentOption;
  selected: boolean;
  onSelect: () => void;
  onConfigure: () => void;
}>) {
  const meta = EXAMPLE_META[option.key] ?? FALLBACK_META;

  return (
    <article
      className={`example-card ${selected ? "selected" : ""}`}
      style={{ ["--ex-accent" as string]: meta.accent }}
    >
      <button
        type="button"
        className="example-card__select"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${selected ? "Selected" : "Select"} ${option.label}`}
      >
        {meta.beta && <span className="example-card__beta">Beta</span>}
        <div className="example-card__header">
          <img className="example-card__logo" src="/nvidia-nim-icon.png" alt="NVIDIA NIM" />
          <h3 className="example-card__title">
            {(meta.titleLines ?? [option.label]).map((line) => (
              <span key={line}>{line}</span>
            ))}
          </h3>
        </div>
        <p className="example-card__blurb">{meta.blurb}</p>
        <div className="example-card__tags">
          {meta.tags.map((tag) => (
            <span key={tag} className="ex-tag">{tag}</span>
          ))}
        </div>

        {meta.feature && <p className="example-card__feature">{meta.feature}</p>}

        {meta.samples && meta.samples.length > 0 && (
          <div className="example-card__samples">
            <span className="ex-samples-label">Try saying</span>
            <ul>
              {meta.samples.map((sample) => (
                <li key={sample}>“{sample}”</li>
              ))}
            </ul>
          </div>
        )}
      </button>
      <div className="example-card__actions">
        <button
          type="button"
          className="example-card__cta"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`${selected ? "Selected" : "Select"} ${option.label}`}
        >
          {selected ? "✓ Selected" : "Select example"}
        </button>
        <button type="button" className="btn-ghost example-card__configure" onClick={onConfigure}>
          Configure
        </button>
      </div>
    </article>
  );
}

function StartView({ connecting }: Readonly<{ connecting: boolean }>) {
  const {
    deploymentOptions,
    selectedExample,
    selectExample,
    llmsLoading,
    asrLoading,
    ttsLoading,
    promptsLoading,
    toolsLoading,
  } = useApp();
  const { beginSession, connectionError } = useSessionLifecycle();
  const [configOpen, setConfigOpen] = useState(false);
  const configurationLoading = llmsLoading || asrLoading || ttsLoading || promptsLoading || toolsLoading;

  const openConfig = (key: string) => {
    selectExample(key);
    setConfigOpen(true);
  };

  return (
    <div className="startview">
      <div className="startview__hero" data-tour="welcome">
        <p className="startview__eyebrow">NVIDIA</p>
        <h1 className="startview__title"><span className="wm-green">Nemotron</span> <span className="wm-flow">Voice Agent</span></h1>
        <p className="startview__subtitle">Pick an assistant, choose how it runs, and start a live voice conversation.</p>
      </div>

      <div className="example-grid" data-tour="examples">
        {deploymentOptions.map((option) => (
          <ExampleCard
            key={option.key}
            option={option}
            selected={selectedExample?.key === option.key}
            onSelect={() => selectExample(option.key)}
            onConfigure={() => openConfig(option.key)}
          />
        ))}
      </div>

      {selectedExample && (
        <section className="startview__launch" aria-label="Selected example actions">
          <div className="startview__selection">
            <span className="startview__selection-label">Selected example</span>
            <strong>{selectedExample.label}</strong>
          </div>
          <button
            type="button"
            className="btn-secondary"
            data-tour="configure"
            onClick={() => openConfig(selectedExample.key)}
            disabled={connecting}
          >
            Configure
          </button>
          <button
            type="button"
            className="btn-primary btn-bubbly"
            data-tour="start"
            onClick={() => void beginSession()}
            disabled={connecting || configurationLoading}
          >
            {connecting ? "Connecting…" : configurationLoading ? "Preparing…" : "Start conversation"}
          </button>
        </section>
      )}

      {connectionError && !configOpen && <p className="startview__error" role="alert">{connectionError}</p>}

      {configOpen && selectedExample && (
        <ExampleConfigModal
          option={selectedExample}
          connecting={connecting}
          connectionError={connectionError}
          onStart={() => void beginSession()}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </div>
  );
}

function ConversationLive() {
  const { selectedExample, currentSessionId } = useApp();
  const webcam = selectedExample?.capabilities?.includes("webcam") ?? false;
  return (
    <div className="conv-live">
      {currentSessionId && (
        <button
          type="button"
          className="conv-session-id"
          title="Copy session ID (share it if you give feedback)"
          onClick={() => void navigator.clipboard?.writeText(currentSessionId)}
        >
          Session <code>{currentSessionId}</code>
        </button>
      )}
      <div className="conv-live__main">
        <ConversationPanel />
      </div>
      {webcam && currentSessionId && (
        <aside className="conv-live__webcam">
          <p className="conv-live__webcam-label">Webcam vision</p>
          <WebcamVisionPanel sessionId={currentSessionId} />
        </aside>
      )}
      <div className="conv-live__dock">
        <MicButton />
      </div>
    </div>
  );
}

export function ConversationStage() {
  const { isConnected, isConnecting } = useConnectionState();
  const { phase } = useSessionLifecycle();
  // Keep the live view mounted through teardown so it doesn't flash back to the
  // landing between disconnect and the thank-you/stopping overlay.
  if (isConnected || phase === "stopping") return <ConversationLive />;
  return <StartView connecting={isConnecting || phase === "starting"} />;
}
