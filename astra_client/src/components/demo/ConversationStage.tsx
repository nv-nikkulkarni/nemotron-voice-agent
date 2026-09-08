// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// The main page body: pick an example + record choice + Start (idle), or the
// live orb + transcript (connected). Nothing else — settings/pipeline-info live
// on their own pages.

import { useEffect, useState } from "react";
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
  option, selected, onSelect,
}: Readonly<{ option: DeploymentOption; selected: boolean; onSelect: () => void }>) {
  const meta = EXAMPLE_META[option.key] ?? FALLBACK_META;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`example-card ${selected ? "selected" : ""}`}
      style={{ ["--ex-accent" as string]: meta.accent }}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }
      }}
      aria-pressed={selected}
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
        {meta.tags.map((t) => (
          <span key={t} className="ex-tag">{t}</span>
        ))}
      </div>

      {meta.feature && <p className="example-card__feature">{meta.feature}</p>}

      {meta.samples && meta.samples.length > 0 && (
        <div className="example-card__samples">
          <span className="ex-samples-label">Try saying</span>
          <ul>
            {meta.samples.map((s) => (
              <li key={s}>“{s}”</li>
            ))}
          </ul>
        </div>
      )}

      <span className="example-card__cta">{selected ? "✓ Selected" : "Configure & start →"}</span>
    </div>
  );
}

function StartView({ connecting }: Readonly<{ connecting: boolean }>) {
  const { deploymentOptions, selectedExample, selectExample } = useApp();
  const { beginSession, connectionError } = useSessionLifecycle();
  const [configOpen, setConfigOpen] = useState(false);

  // Clicking a card selects the example and opens its configuration popup (LLM /
  // TTS / tools). The popup is the launch surface — it starts the conversation.
  const openConfig = (key: string) => { selectExample(key); setConfigOpen(true); };

  // If a connection error surfaces while the popup is closed, reopen it so the user sees it.
  useEffect(() => {
    if (connectionError && selectedExample) setConfigOpen(true);
  }, [connectionError, selectedExample]);

  return (
    <div className="startview">
      <div className="startview__hero">
        <p className="startview__eyebrow">NVIDIA</p>
        <h1 className="startview__title"><span className="wm-green">Nemotron</span> <span className="wm-flow">Voice Agent</span></h1>
        <p className="startview__subtitle">Pick an assistant, choose how it runs, and start a live voice conversation.</p>
      </div>

      <div className="example-grid">
        {deploymentOptions.map((o) => (
          <ExampleCard key={o.key} option={o} selected={selectedExample?.key === o.key} onSelect={() => openConfig(o.key)} />
        ))}
      </div>

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
