// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Owns "start / stop a voice session". It builds the session-config body from the
// composed pipeline (selected NIMs + voice + editable prompt + selected tools)
// and connects the pipecat client over WebSocket or WebRTC. In the curated demo
// everything maps onto the one cascaded pipeline (generic-assistant); a preset
// override lets the landing page start a prebuilt pipeline without a state race.

import { useCallback, useState } from "react";
import { usePipecatClient, usePipecatClientMicControl } from "@pipecat-ai/client-react";
import { useConnectionState } from "./useConnectionState";
import { useApp } from "../context/useApp";
import {
  createSessionConfig,
  createWebRTCSession,
  type DeploymentOption,
  type ExampleVariant,
  type LLMService,
  type SimpleService,
  type SessionConfigBody,
} from "../api";
import { demoConfig } from "../config";
import type { PipelinePreset } from "../demo/presets";
import { advanceBotAudioSession } from "../demo/turnAwareMediaManager";
import { getModelChoice } from "../demo/agentConfig";

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
  /** Launch one of the example's registry variants (e.g. the Hindi assistant). */
  variant?: ExampleVariant;
  /** Session-config fields of a custom agent from the builder (validated by the builder service). */
  custom?: Record<string, unknown>;
}

/** The only fields a custom agent may set; everything else keeps the example's own session config. */
const CUSTOM_SESSION_KEYS = [
  "example_variant", "asr_language_code", "llm_id", "thinker_llm_id", "tools_available", "persistent_prompt", "persona_token",
  "asr_id", "tts_id", "tts_voice_id", "tts_pronunciations",
] as const;

export function useVoiceSession() {
  const client = usePipecatClient() as StartBotClient | undefined;
  const { enableMic } = usePipecatClientMicControl();
  const { isConnected, isConnecting } = useConnectionState();
  const app = useApp();
  const [connectionError, setConnectionError] = useState("");
  const clearError = useCallback(() => setConnectionError(""), []);

  const buildConfig = useCallback(
    (example: DeploymentOption, preset?: PipelinePreset, variant?: ExampleVariant, custom?: Record<string, unknown>): SessionConfigBody => {
      const slots = new Set(example.slots);
      const config: SessionConfigBody = { pipeline_mode: example.key };
      if (custom) {
        // A custom agent is exactly what the builder produced: nothing from the built-in example's
        // selections (voice, prompts, model overrides, voice sample) may leak into it.
        config.client_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        if (example.backendHistory) config.backend_history_turn_limit = app.backendHistoryTurnLimit;
        for (const key of CUSTOM_SESSION_KEYS) {
          if (custom[key] !== undefined) config[key] = custom[key] as SessionConfigBody[string];
        }
        return config;
      }
      if (variant) config.example_variant = variant.id;
      // A session-language example locks ASR, TTS, and prompts to one language. A
      // variant with a fixed language wins over the picker (the server enforces it too).
      const sessionLanguage = example.capabilities?.includes("session_languages")
        ? variant?.session_language || app.selectedSessionLanguage
        : "";
      if (sessionLanguage) config.asr_language_code = sessionLanguage;
      if (Object.keys(app.llmOverrides).length) config.llm_role_settings = app.llmOverrides;
      config.client_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      if (example.backendHistory) config.backend_history_turn_limit = app.backendHistoryTurnLimit;
      if (app.backendPromptOverride.trim()) config.thinker_prompt_content = app.backendPromptOverride;

      // Resolve services: a preset's preferred NIM (by key) wins for a direct
      // launch; otherwise the user's current selection from context.
      const llm: LLMService | undefined =
        (preset && byKey(app.llms, preset.llmKey)) || (variant && byKey(app.llms, variant.llm)) || app.selectedLLM;
      const asr: SimpleService | undefined = (preset && byKey(app.asrServices, preset.asrKey)) || app.selectedASR;
      const tts: SimpleService | undefined = (preset && byKey(app.ttsServices, preset.ttsKey)) || app.selectedTTS;
      // A voice picked for another language would be wrong for a fixed-language
      // variant; leave it to the server, which resolves a voice for the language.
      const languageChanged = !!variant?.session_language && variant.session_language !== app.selectedSessionLanguage;
      // A variant with its own default voice (Hindi: Leo) is not overridden by the catalog default.
      const voiceId = preset?.voiceId || (languageChanged ? "" : app.selectedVoiceId || (variant?.tts_voice ? "" : tts?.voiceId));

      if (slots.has("llm") && llm) {
        config.llm_id = llm.id;
        if (!llm.builtIn) {
          config.model_id = llm.modelId;
          config.base_url = llm.baseUrl;
          if (llm.systemPrompt) config.system_prompt = llm.systemPrompt;
        }
        // The backend owns a built-in LLM's extra_params and applies the Reasoning
        // toggle through its catalog settings (enable_thinking). A custom LLM has no
        // catalog entry, so its extra_params carry the toggle directly.
        if (llm.builtIn) {
          if (example.domainProfile !== "generic") config.llm_settings = { enable_thinking: app.reasoning };
        } else {
          config.extra_params = buildExtraParams(llm.extraParams, app.reasoning);
        }
      }
      // The variant's Talker may not be in the LLM list yet when the card launches a
      // session right after switching examples; the catalog id is stable, so send it.
      if (slots.has("llm") && variant?.llm && !byKey(app.llms, variant.llm)) config.llm_id = `self-hosted:${variant.llm}`;
      // Models page choices for this example. A Talker that does not speak the session
      // language is ignored, so a fixed-language launch never fails on a saved choice.
      const choice = getModelChoice(example.key);
      const pickedTalker = choice.talker ? app.llms.find((item) => item.id === choice.talker) : undefined;
      const sessionBase = sessionLanguage.split("-")[0].toLowerCase();
      if (slots.has("llm") && pickedTalker?.builtIn
        && (!sessionBase || !pickedTalker.supportedLanguages?.length || pickedTalker.supportedLanguages.includes(sessionBase))) {
        config.llm_id = pickedTalker.id;
      }
      if (choice.backend) config.thinker_llm_id = choice.backend;
      applyService(config, slots.has("asr"), "asr", asr, { model: asr?.model, function_id: asr?.functionId });
      applyService(config, slots.has("tts"), "tts", tts, { function_id: tts?.functionId });
      if (slots.has("tts") && /magpie/i.test(tts?.model ?? "") && Object.keys(app.pronunciationOverrides).length) {
        config.tts_pronunciations = app.pronunciationOverrides;
      }
      if (slots.has("tts") && voiceId) config.tts_voice_id = voiceId;
      if (slots.has("tts") && app.useVoiceSample && app.voiceSample && /zero.?shot/i.test(tts?.model ?? "")) {
        config.tts_voice_sample = app.voiceSample.audio;
      }

      if (demoConfig.demoMode) {
        // Prompt: the example's ORIGINAL prompt by default (prompt_key only, so the
        // backend uses the repo prompt verbatim); an edited prompt overrides it.
        if (app.promptOverride.trim()) {
          config.prompt_key = `${example.key}_edited`;
          config.prompt_content = app.promptOverride;
        } else if (app.selectedPromptKey) {
          config.prompt_key = app.selectedPromptKey;
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

        const config = buildConfig(example, opts.preset, opts.variant, opts.custom);

        // The transport retains its microphone setting after disconnect. A new
        // session must reacquire audio even when the previous session ended
        // muted; otherwise Daily waits for a track that was never requested.
        enableMic(true);

        if (app.selectedTransport === "websocket") {
          const sessionId = await createSessionConfig(config);
          const wsProto = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
          // WavStreamPlayer retains interrupted track IDs across reconnects. A
          // new session must use a fresh ID or its welcome PCM can be discarded
          // while later audio starts working after the first user interruption.
          advanceBotAudioSession();
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
    [client, app, buildConfig, enableMic],
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
