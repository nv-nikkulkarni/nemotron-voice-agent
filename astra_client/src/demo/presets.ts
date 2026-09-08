// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Pipeline presets — the demo's two prebuilt configurations of the ONE cascaded
// voice-agent pipeline (generic-assistant: ASR → LLM → TTS + tools). Each preset
// is a full pipeline: a persona/system prompt, a tool set, and preferred NIMs
// (LLM / ASR / TTS + voice). The landing page offers these two to talk to; the
// builder loads the chosen one and lets you edit every node.
//
// Model preferences are catalog KEYS (e.g. "nemotron-nano"); the app resolves
// them against /api/services ids ("<source>:<key>") at apply time and falls back
// to the catalog default when a preferred model isn't deployed/reachable.

export interface PipelinePreset {
  id: string;
  title: string;
  tagline: string;
  icon: string;
  accent: string;
  /** Editable system prompt (sent as prompt_content). */
  promptContent: string;
  /** Tool names to enable (validated server-side against the tool catalog). */
  tools: string[];
  llmKey?: string;
  asrKey?: string;
  ttsKey?: string;
  voiceId?: string;
  suggestions: string[];
}

// The news tool is always hardcoded/fake (no live integration exists), so it is
// hidden from the demo — every other surfaced tool returns a real result.
export const HIDDEN_TOOLS = new Set<string>(["get_news_headlines"]);

export function isToolVisible(name: string): boolean {
  return !HIDDEN_TOOLS.has(name);
}

export const PRESETS: PipelinePreset[] = [
  {
    id: "everyday-assistant",
    title: "Everyday Assistant",
    tagline: "A fast, friendly assistant with live tools — weather, markets, math.",
    icon: "🟢",
    accent: "#76b900",
    llmKey: "nemotron-nano",
    asrKey: "nemotron-asr-streaming-english",
    ttsKey: "magpie-tts",
    voiceId: "Magpie-Multilingual.EN-US.Aria",
    tools: [
      "get_weather",
      "get_stock_price",
      "convert_currency",
      "get_current_date_time",
      "calculate_bmi",
      "generate_random_number",
    ],
    promptContent: `You are the Nemotron Voice Agent — a warm, fast, real-time voice assistant with live tools. This is a 2-minute demo showing a voice agent can DO things, not just chat.

You can call tools for: weather, stock prices, currency conversion, the date and time, BMI, and random numbers.
- Greet the visitor and, in ONE short sentence, suggest something concrete to try: "Ask me the weather in Tokyo, a stock price, or to convert 100 dollars to euros."
- When a request maps to a tool, CALL the tool and speak the result in one natural sentence.
- Keep replies to 1-2 spoken sentences. Summarize data — never read raw numbers or long lists aloud.
- Stay friendly and snappy; this is a live demo.`,
    suggestions: [
      "What's the weather in Tokyo?",
      "What's NVIDIA's stock price?",
      "Convert 100 dollars to euros.",
    ],
  },
  {
    id: "reasoning-concierge",
    title: "Reasoning Concierge",
    tagline: "A thoughtful concierge with reasoning enabled and a second voice.",
    icon: "🧭",
    accent: "#8b5cf6",
    llmKey: "nemotron-lightning-reasoning",
    asrKey: "nemotron-asr-streaming-english",
    ttsKey: "chatterbox-tts",
    voiceId: "Chatterbox-Multilingual.en-US.Male",
    tools: ["convert_currency", "get_current_date_time", "get_weather", "calculate_bmi"],
    promptContent: `You are the Nemotron Voice Agent in "concierge" mode — a calm, thoughtful assistant running on Nemotron 3.5 Lightning with reasoning enabled. This is a 2-minute demo showing how a cascaded pipeline lets you turn on thinking and swap in a different voice.

You can call tools for: currency conversion, the date and time, weather, and BMI.
- Greet the visitor as their concierge and, in ONE short sentence, invite a question worth thinking about, or a quick task.
- Reason briefly when it helps, but keep spoken replies to 1-2 natural sentences. Never read long lists aloud.
- When a request maps to a tool, CALL the tool and weave the result into your answer.
- Be gracious and unhurried; you are the premium experience.`,
    suggestions: [
      "Help me plan a weekend trip.",
      "What's 250 euros in yen?",
      "What time is it in London?",
    ],
  },
];

export function presetById(id: string | undefined): PipelinePreset | undefined {
  return id ? PRESETS.find((p) => p.id === id) : undefined;
}
