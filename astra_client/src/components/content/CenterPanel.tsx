// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import { useState } from "react";
import { useConnectionState } from "../../hooks/useConnectionState";
import { demoConfig } from "../../config";
import { IdleHero } from "./IdleHero";
import { StartScreen } from "./StartScreen";
import { ConversationPanel } from "./ConversationPanel";
import { MetricsPanel } from "./MetricsPanel";
import { ServicesPanel } from "./ServicesPanel";
import { PromptsPanel } from "./PromptsPanel";
import { ToolsPanel } from "./ToolsPanel";
import { CustomizeBuilder } from "./CustomizeBuilder";

type Tab = "conversation" | "customize" | "metrics" | "services" | "prompts" | "tools";

// The curated demo drops the standalone SERVICES, TOOLS, and PROMPTS tabs — the
// active pipeline's services + tools show on the conversation page, and services,
// tools, and the (editable) prompt are all composed in the CUSTOMIZE builder.
const DEMO_TABS: { id: Tab; label: string }[] = [
  { id: "conversation", label: "CONVERSATION" },
  { id: "customize", label: "CUSTOMIZE" },
  { id: "metrics", label: "METRICS" },
];

const FULL_TABS: { id: Tab; label: string }[] = [
  { id: "conversation", label: "CONVERSATION" },
  { id: "metrics", label: "METRICS" },
  { id: "services", label: "SERVICES" },
  { id: "prompts", label: "PROMPTS" },
  { id: "tools", label: "TOOLS" },
];

function ConversationContent({ onCustomize }: Readonly<{ onCustomize: () => void }>) {
  const { isConnected, isConnecting } = useConnectionState();

  if (!isConnected) {
    if (demoConfig.demoMode && !isConnecting) {
      return <StartScreen onCustomize={onCustomize} />;
    }
    return <IdleHero connecting={isConnecting} fadingOut={false} />;
  }

  return <ConversationPanel />;
}

export function CenterPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("conversation");
  const demo = demoConfig.demoMode;
  const tabs = demo ? DEMO_TABS : FULL_TABS;

  return (
    <main className="flex-1 d-flex flex-col overflow-hidden">
      <div className="tab-header">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={`flex-1 min-h-0 relative ${activeTab !== "conversation" ? "hidden" : ""}`}>
        <div className="conversation-overlay overflow-y-auto">
          <ConversationContent onCustomize={() => setActiveTab("customize")} />
        </div>
      </div>
      {demo && (
        <div className={`flex-1 min-h-0 overflow-y-auto ${activeTab !== "customize" ? "hidden" : ""}`}>
          <CustomizeBuilder onLaunched={() => setActiveTab("conversation")} />
        </div>
      )}
      <div className={`flex-1 min-h-0 overflow-y-auto ${activeTab !== "metrics" ? "hidden" : ""}`}>
        <MetricsPanel />
      </div>
      {!demo && (
        <>
          <div className={`flex-1 min-h-0 overflow-y-auto ${activeTab !== "prompts" ? "hidden" : ""}`}>
            <PromptsPanel />
          </div>
          <div className={`flex-1 min-h-0 overflow-y-auto ${activeTab !== "services" ? "hidden" : ""}`}>
            <ServicesPanel />
          </div>
          <div className={`flex-1 min-h-0 overflow-y-auto ${activeTab !== "tools" ? "hidden" : ""}`}>
            <ToolsPanel />
          </div>
        </>
      )}
    </main>
  );
}
