// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Agent configuration (schema v1): the shape the builder produces, the YAML file format for
// saving and loading an agent, the builder API client, and a small persisted store for the
// custom agent and per-example model choices. The builder prompt and model key stay server-side.

import { useSyncExternalStore } from "react";
import yaml from "js-yaml";
import { readLSString, writeLSJson } from "../utils";

export const AGENT_SCHEMA = "nemotron-voice-agent/agent-config";
export const AGENT_VERSION = 1;
/** The example a custom agent runs as. */
export const CUSTOM_BASE_EXAMPLE = "multilingual-generic-frontend-backend-agent";
export const MAX_AGENT_FILE_BYTES = 16 * 1024;

export interface AgentPersona {
  name: string;
  role: string;
  tone: string;
  about: string;
  always: string[];
  never: string[];
}

export interface AgentConfig {
  schema: string;
  version: number;
  name: string;
  base_example: string;
  language: string;
  persona: AgentPersona;
  models: { talker: string; backend: string };
  speech: { asr: string; tts: string; voice: string; pronunciations: Record<string, string> };
  tools: string[];
}

export interface BuilderCatalog {
  languages: string[];
  talkers: { id: string; name: string; languages: string[] }[];
  backends: { id: string; name: string }[];
  asr: { id: string; name: string }[];
  tts: { id: string; name: string }[];
  voices: { id: string; name: string; language: string }[];
  tools: { name: string; description: string }[];
  tones: string[];
}

export interface BuilderState {
  draft_config: AgentConfig;
  missing: string[];
  ready: boolean;
  warnings: string[];
}

export interface BuilderSession extends BuilderState {
  session_id: string;
  reply: string;
  catalog: BuilderCatalog;
}

export interface BuilderTurn extends BuilderState {
  reply: string;
  intent: "build" | "clarify" | "off_topic" | "refused";
}

export interface BuilderCheck extends BuilderState {
  errors: string[];
  session_config?: Record<string, unknown>;
}

async function builderFetch<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/builder-api/${path}`, body === undefined
    ? undefined
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const detail = await response.json().then((data: { detail?: unknown }) => data.detail).catch(() => undefined);
    throw new Error(typeof detail === "string" ? detail : `The builder is unavailable (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export const builderApi = {
  start: () => builderFetch<BuilderSession>("session", {}),
  turn: (sessionId: string, message: string) => builderFetch<BuilderTurn>("turn", { session_id: sessionId, message }),
  validate: (config: AgentConfig) => builderFetch<BuilderCheck>("validate", { config }),
  load: (sessionId: string, config: AgentConfig) => builderFetch<BuilderCheck>("load", { session_id: sessionId, config }),
};

// --- YAML file format -------------------------------------------------------------------

const FILE_HEADER = "# Nemotron Voice Agent: agent configuration (schema v1).\n# Load it from Build your own agent. It never contains keys or secrets.\n";

export function dumpAgentConfig(config: AgentConfig): string {
  return FILE_HEADER + yaml.dump(config, { lineWidth: 100, noRefs: true, sortKeys: false });
}

/** Parse an agent file. Throws an Error with a message fit to show the person. */
export function parseAgentConfig(text: string): AgentConfig {
  if (new Blob([text]).size > MAX_AGENT_FILE_BYTES) throw new Error("That file is too large to be an agent configuration.");
  // Anchors and aliases can expand a small file into a huge object; saved agents never use them.
  if (/(^|[\s[{,:-])[&*][^\s,\]}]+/m.test(text)) throw new Error("That file uses YAML anchors, which agent files do not support.");
  let data: unknown;
  try {
    data = yaml.load(text);
  } catch {
    throw new Error("That file is not valid YAML.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("That file is not an agent configuration.");
  const record = data as Record<string, unknown>;
  if (record.schema !== AGENT_SCHEMA) throw new Error("That file is not a Nemotron Voice Agent configuration.");
  if (record.version !== AGENT_VERSION) throw new Error(`Unsupported agent file version ${String(record.version)}.`);
  return record as unknown as AgentConfig;
}

export function agentFileName(config: AgentConfig): string {
  const base = (config.persona.name || config.name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "agent"}.agent.yaml`;
}

/** Download a text file from the browser. */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// --- Persisted store: the started custom agent and per-example model choices ---------------

export interface ModelChoice { talker?: string; backend?: string }
interface AgentStore {
  customAgent: { config: AgentConfig; sessionConfig: Record<string, unknown> } | null;
  modelChoices: Record<string, ModelChoice>;
}

const STORE_KEY = "nva-agent-store";

function readStore(): AgentStore {
  const empty: AgentStore = { customAgent: null, modelChoices: {} };
  try {
    const raw = readLSString(STORE_KEY);
    const value = raw ? (JSON.parse(raw) as Partial<AgentStore>) : {};
    return { customAgent: value.customAgent ?? null, modelChoices: value.modelChoices ?? {} };
  } catch {
    return empty;
  }
}

let store: AgentStore = readStore();
const listeners = new Set<() => void>();

function commit(next: AgentStore): void {
  store = next;
  writeLSJson(STORE_KEY, next);
  listeners.forEach((listener) => listener());
}

export function useAgentStore(): AgentStore {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => store,
  );
}

export function getModelChoice(exampleKey: string): ModelChoice {
  return store.modelChoices[exampleKey] ?? {};
}

export function setModelChoice(exampleKey: string, choice: ModelChoice): void {
  const modelChoices = { ...store.modelChoices };
  if (choice.talker || choice.backend) modelChoices[exampleKey] = choice;
  else delete modelChoices[exampleKey];
  commit({ ...store, modelChoices });
}

export function setCustomAgent(customAgent: AgentStore["customAgent"]): void {
  commit({ ...store, customAgent });
}
