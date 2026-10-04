// SPDX-License-Identifier: BSD-2-Clause
import type { LLMSettings, SamplingParameter } from "../api";

export const SAMPLING_FIELDS: Record<SamplingParameter, {label: string; min: number; max: number; step: number; description: string}> = {
  temperature: {label: "Temperature", min: 0, max: 2, step: 0.05, description: "Higher values make responses more varied. Zero is the most deterministic."},
  top_p: {label: "Top P", min: 0.000001, max: 1, step: 0.05, description: "Limits sampling to the most likely tokens. One uses the full distribution."},
  max_tokens: {label: "Max tokens", min: 64, max: 32768, step: 1, description: "Generation budget, including reasoning. Low limits can truncate answers or tool plans."},
  top_k: {label: "Top K", min: -1, max: 1000, step: 1, description: "One is greedy. Use −1 to disable the limit; zero is invalid."},
  repetition_penalty: {label: "Repetition penalty", min: 0.1, max: 2, step: 0.05, description: "One is neutral. Higher values discourage repeated tokens."},
  frequency_penalty: {label: "Frequency penalty", min: -2, max: 2, step: 0.05, description: "Positive values discourage tokens used frequently."},
  presence_penalty: {label: "Presence penalty", min: -2, max: 2, step: 0.05, description: "Positive values encourage introducing different tokens."},
};
export function validSamplingValue(field: SamplingParameter, value: number): boolean {
  const {min, max} = SAMPLING_FIELDS[field];
  return Number.isFinite(value) && value >= min && value <= max &&
    (!(field === "top_k" || field === "max_tokens") || Number.isInteger(value)) && (field !== "top_k" || value !== 0);
}
export function cleanLLMSettings(raw: unknown): LLMSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const roles = new Set(["frontend", "backend", "speaker", "thinker", "media", "webcam"]);
  return Object.fromEntries(Object.entries(raw).filter(([role, values]) => roles.has(role) && values && typeof values === "object" && !Array.isArray(values))
    .map(([role, values]) => [role, Object.fromEntries(Object.entries(values).filter(([field, value]) =>
      field in SAMPLING_FIELDS && typeof value === "number" && validSamplingValue(field as SamplingParameter, value)))]));
}
