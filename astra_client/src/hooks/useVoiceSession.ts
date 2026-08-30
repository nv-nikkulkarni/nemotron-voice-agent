// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Owns "start / stop a voice session". It builds the session-config body from the
// composed pipeline (selected NIMs + voice + editable prompt + selected tools)
// and connects the pipecat client over WebSocket or WebRTC. In the curated demo
// everything maps onto the one cascaded pipeline (generic-assistant); a preset
// override lets the landing page start a prebuilt pipeline without a state race.

import { useCallback, useState } from "react";
import { usePipecatClient } from "@pipecat-ai/client-react";
import { useConnectionState } from "./useConnectionState";
import { useApp } from "../context/useApp";
import {
  createSessionConfig,
  createWebRTCSession,
  type DeploymentOption,
  type LLMService,
  type SimpleService,
  type SessionConfigBody,
} from "../api";
import { demoConfig } from "../config";
import type { PipelinePreset } from "../demo/presets";
import { DEMO_PROMPT_OVERRIDES } from "../demo/promptOverrides";

type StartBotClient = {
  connect: (args: { wsUrl?: string; webrtcUrl?: string }) => Promise<void>;
  disconnect: () => Promise<void>;
  initDevices: () => Promise<void>;
};

const WEBRTC_CONNECT_TIMEOUT_MS = 30_000;
const WEBRTC_TIMEOUT_ERROR_NAME = "WebRTCConnectionTimeoutError";

function getConnectionErrorMessage(err: unknown): string {
  const fallback = "Connection failed. Please try again.";
  let rawMessage = fallback;
  if (err instanceof Error) rawMessage = err.message;
  else if (typeof err === "string") rawMessage = err;

  const jsonStart = rawMessage.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart)) as { info?: string; detail?: string };
      if (parsed.info) return parsed.info;
      if (parsed.detail) return parsed.detail;
    } catch {
      /* not JSON */
    }
  }
  return rawMessage.replace(/^HTTP \d+:?\s*/, "") || fallback;
}

function getWebRTCTimeoutMessage(): string {
  return `WebRTC connection timed out after ${WEBRTC_CONNECT_TIMEOUT_MS / 1000}s. Check microphone permissions and network connectivity, or configure TURN.`;
}

function isWebRTCTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === WEBRTC_TIMEOUT_ERROR_NAME;
}

async function withWebRTCConnectTimeout(promise: Promise<void>): Promise<void> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      const error = new Error("WebRTC connection timed out");
      error.name = WEBRTC_TIMEOUT_ERROR_NAME;
      reject(error);
    }, WEBRTC_CONNECT_TIMEOUT_MS);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  }
}

function applyService(
  config: SessionConfigBody,
  enabled: boolean,
  prefix: "asr" | "tts",
  service: SimpleService | undefined,
  optional: Record<string, string | undefined>,
): void {
  if (!enabled || !service) return;
  config[`${prefix}_id`] = service.id;
  if (!service.builtIn) {
    config[`${prefix}_server`] = service.server;
    for (const [field, value] of Object.entries(optional)) {
      if (value) config[`${prefix}_${field}`] = value;
    }
  }
}

/** Resolve a preset key (e.g. "magpie-tts") to a catalog service, if present. */
function byKey<T extends { id: string }>(items: T[], key: string | undefined): T | undefined {
  if (!key) return undefined;
  return items.find((i) => i.id === key || i.id.endsWith(`:${key}`) || i.id.split(":").pop() === key);
}

/**
 * Merge the Reasoning toggle into an LLM's extra_params JSON. Keeps any existing
 * fields (e.g. repetition_penalty) and sets
 * ``extra_body.chat_template_kwargs.enable_thinking`` to the toggle value.
 */
function buildExtraParams(extraParams: string | undefined, reasoning: boolean): string {
  type ExtraParams = {
    extra_body?: { chat_template_kwargs?: Record<string, unknown> } & Record<string, unknown>;
  } & Record<string, unknown>;
  let parsed: ExtraParams;
  try {
    parsed = extraParams ? (JSON.parse(extraParams) as ExtraParams) : { extra_body: { chat_template_kwargs: {} } };
  } catch {
    parsed = { extra_body: { chat_template_kwargs: {} } };
  }
  parsed.extra_body ??= {};
  parsed.extra_body.chat_template_kwargs ??= {};
  parsed.extra_body.chat_template_kwargs.enable_thinking = reasoning;
  return JSON.stringify(parsed);
}

function sessionIdFromWebRTCUrl(url: string): string {
  const query = url.split("?", 2)[1] ?? "";
  return new URLSearchParams(query).get("session_id") ?? "";
}

export interface StartOptions {
  /** Start a prebuilt preset directly (landing page), bypassing edited state. */
  preset?: PipelinePreset;
}

export function useVoiceSession() {
  const client = usePipecatClient() as StartBotClient | undefined;
  const { isConnected, isConnecting } = useConnectionState();
  const app = useApp();
  const [connectionError, setConnectionError] = useState("");
  const clearError = useCallback(() => setConnectionError(""), []);

  const buildConfig = useCallback(
    (example: DeploymentOption, preset?: PipelinePreset): SessionConfigBody => {
      const slots = new Set(example.slots);
      const config: SessionConfigBody = { pipeline_mode: example.key };

      // Resolve services: a preset's preferred NIM (by key) wins for a direct
      // launch; otherwise the user's current selection from context.
      const llm: LLMService | undefined = (preset && byKey(app.llms, preset.llmKey)) || app.selectedLLM;
      const asr: SimpleService | undefined = (preset && byKey(app.asrServices, preset.asrKey)) || app.selectedASR;
      const tts: SimpleService | undefined = (preset && byKey(app.ttsServices, preset.ttsKey)) || app.selectedTTS;
      const voiceId = preset?.voiceId || app.selectedVoiceId || tts?.voiceId;

      if (slots.has("llm") && llm) {
        config.llm_id = llm.id;
        if (!llm.builtIn) {
          config.model_id = llm.modelId;
          config.base_url = llm.baseUrl;
          if (llm.systemPrompt) config.system_prompt = llm.systemPrompt;
        }
        // Always carry the LLM's extra_params so the Reasoning toggle
        // (enable_thinking chat-template kwarg) reaches the backend, which
        // applies extra_params as an override for built-in and custom LLMs alike.
        config.extra_params = buildExtraParams(llm.extraParams, app.reasoning);
      }
      applyService(config, slots.has("asr"), "asr", asr, { model: asr?.model, function_id: asr?.functionId });
      applyService(config, slots.has("tts"), "tts", tts, { function_id: tts?.functionId });
      if (slots.has("tts") && voiceId) config.tts_voice_id = voiceId;

      if (demoConfig.demoMode) {
        // Prompt: the example's ORIGINAL prompt by default (prompt_key only, so the
        // backend uses the repo prompt verbatim); an edited prompt overrides it.
        if (app.promptOverride.trim()) {
          config.prompt_key = `${example.key}_edited`;
          config.prompt_content = app.promptOverride;
        } else if (app.selectedPromptKey) {
          config.prompt_key = app.selectedPromptKey;
          // Demo default: override only the wording (concise, speech-friendly)
          // while keeping the real key so the backend still resolves this
          // example's tools. Keeps the backend prompts.yaml pristine.
          const demoPrompt = DEMO_PROMPT_OVERRIDES[example.key];
          if (demoPrompt) config.prompt_content = demoPrompt;
        }
        // Editable model URL: sending model_id + base_url without llm_id bypasses
        // built-in hydration so the pipeline uses the custom endpoint.
        if (app.modelUrlOverride.trim() && llm) {
          delete config.llm_id;
          config.model_id = llm.modelId;
          config.base_url = app.modelUrlOverride.trim();
        }
      } else if (app.selectedPromptKey) {
        config.prompt_key = app.selectedPromptKey;
        if (app.selectedPrompt && !app.selectedPrompt.builtIn) config.prompt_content = app.selectedPrompt.content;
      }

      // Per-session tool selection from the example-config popup. Only examples with a
      // tools catalog (generic) have selectable tools; omni has none, so skip it there.
      // "none" tells the backend to disable tools when the user deselects them all.
      if (app.tools.length) {
        config.tools_available = app.selectedTools.length ? app.selectedTools.join(",") : "none";
      }

      return config;
    },
    [app],
  );

  const connect = useCallback(
    async (opts: StartOptions = {}) => {
      setConnectionError("");
      try {
        if (!client) throw new Error("Connection client is not ready yet.");
        const example = app.selectedExample;
        if (!example) throw new Error("Pipeline not loaded yet. Please retry in a moment.");

        const config = buildConfig(example, opts.preset);

        if (app.selectedTransport === "websocket") {
          const sessionId = await createSessionConfig(config);
          const wsProto = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
          app.setCurrentSessionId(sessionId);
          await client.connect({ wsUrl: `${wsProto}//${globalThis.location.host}/api/ws?session_id=${sessionId}` });
        } else {
          await client.initDevices();
          const webrtcUrl = await createWebRTCSession(config);
          const sessionId = sessionIdFromWebRTCUrl(webrtcUrl);
          if (!sessionId) throw new Error("WebRTC session URL did not include session_id.");
          app.setCurrentSessionId(sessionId);
          await withWebRTCConnectTimeout(client.connect({ webrtcUrl }));
        }
      } catch (err) {
        app.setCurrentSessionId("");
        if (isWebRTCTimeoutError(err)) {
          await client?.disconnect().catch(() => undefined);
          setConnectionError(getWebRTCTimeoutMessage());
        } else {
          setConnectionError(getConnectionErrorMessage(err));
        }
        console.error("Connection error:", err);
      }
    },
    [client, app, buildConfig],
  );

  const disconnect = useCallback(async () => {
    try {
      await client?.disconnect();
    } finally {
      app.setCurrentSessionId("");
    }
  }, [client, app]);

  return { connect, disconnect, isConnected, isConnecting, connectionError, clearError };
}
