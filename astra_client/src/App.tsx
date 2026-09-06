// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import { useMemo, useState, type ComponentProps } from "react";
import { PipecatClient } from "@pipecat-ai/client-js";
import { PipecatClientProvider, PipecatClientAudio } from "@pipecat-ai/client-react";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { DailyMediaManager, WebSocketTransport } from "@pipecat-ai/websocket-transport";
import { SafeProtobufFrameSerializer } from "./demo/safeSerializer";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient, useDeployment, useIceServers } from "./api";
import { AppProvider } from "./context/AppContext";
import { useApp } from "./context/useApp";
import { demoConfig } from "./config";
import { TopBar } from "./components/demo/TopBar";
import { ConversationStage } from "./components/demo/ConversationStage";
import { SettingsPage } from "./components/demo/SettingsPage";
import { SessionCaptureReporter } from "./demo/SessionCaptureReporter";
import { PipelineInfo } from "./components/demo/PipelineInfo";
import { SessionControls } from "./components/demo/SessionControls";
import { SessionLifecycleProvider } from "./hooks/useSessionLifecycle";
import { StoppingOverlayHost } from "./components/demo/StoppingOverlay";
// Legacy full app (non-demo builds only).
import { Header } from "./components/Header";
import { StatusPanel } from "./components/status-panel";
import { Sidebar } from "./components/Sidebar";
import { CenterPanel } from "./components/content";

const EMPTY_ICE_SERVERS: RTCIceServer[] = [];
const DEFAULT_AUDIO_INPUT_SAMPLE_RATE = 16000;
const DEFAULT_AUDIO_OUTPUT_SAMPLE_RATE = 22050;
type ProviderClient = ComponentProps<typeof PipecatClientProvider>["client"];
type View = "main" | "settings" | "pipeline";

function AppInner() {
  const { selectedTransport } = useApp();
  const { data: deployment, isFetched: deploymentLoaded } = useDeployment();
  const { data: iceConfig, isFetched: iceServersLoaded } = useIceServers();
  const iceServers = iceConfig?.iceServers ?? EMPTY_ICE_SERVERS;
  const recorderSampleRate = deployment?.audio?.input_sample_rate ?? DEFAULT_AUDIO_INPUT_SAMPLE_RATE;
  const playerSampleRate = deployment?.audio?.output_sample_rate ?? DEFAULT_AUDIO_OUTPUT_SAMPLE_RATE;
  const [view, setView] = useState<View>("main");

  const client = useMemo(() => {
    if (selectedTransport === "websocket") {
      if (!deploymentLoaded) return null;
      const mediaManager = new DailyMediaManager(
        true,
        true,
        undefined,
        undefined,
        512,
        recorderSampleRate,
        playerSampleRate,
      );
      return new PipecatClient({
        transport: new WebSocketTransport({
          serializer: new SafeProtobufFrameSerializer(),
          recorderSampleRate,
          playerSampleRate,
          mediaManager,
        }),
        enableMic: true,
        enableCam: false,
        enableScreenShare: false,
        callbacks: {
          onUserStartedSpeaking: () => {
            void mediaManager.userStartedSpeaking().catch((error: unknown) => {
              console.warn("Unable to interrupt buffered bot audio", error);
            });
          },
        },
      });
    }
    if (!iceServersLoaded) return null;
    return new PipecatClient({ transport: new SmallWebRTCTransport({ iceServers }), enableMic: true });
  }, [
    deploymentLoaded,
    iceServers,
    iceServersLoaded,
    playerSampleRate,
    recorderSampleRate,
    selectedTransport,
  ]);

  if (!client) {
    return <div className="h-screen d-flex items-center justify-center">Loading connection…</div>;
  }

  if (!demoConfig.demoMode) {
    return (
      <PipecatClientProvider client={client as unknown as ProviderClient}>
        <div className="h-screen d-flex flex-col overflow-hidden">
          <Header />
          <div className="flex-1 d-flex overflow-hidden">
            <StatusPanel />
            <CenterPanel />
            <Sidebar />
          </div>
          <PipecatClientAudio />
        </div>
      </PipecatClientProvider>
    );
  }

  return (
    <PipecatClientProvider client={client as unknown as ProviderClient}>
      <SessionLifecycleProvider>
        <div className="clean-app">
          <TopBar onHome={() => setView("main")} onSettings={() => setView("settings")} onPipeline={() => setView("pipeline")} />
          <main className="clean-main">
            <ConversationStage />
          </main>
          <SessionControls />
          <PipecatClientAudio />
          <SessionCaptureReporter />
        </div>
        <StoppingOverlayHost />
        {view === "settings" && <SettingsPage onClose={() => setView("main")} />}
        {view === "pipeline" && <PipelineInfo onClose={() => setView("main")} />}
      </SessionLifecycleProvider>
    </PipecatClientProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <AppInner />
      </AppProvider>
    </QueryClientProvider>
  );
}

export default App;
