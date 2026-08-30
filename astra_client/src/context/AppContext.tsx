// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useDeployment, useDefaultLLMs, useDefaultPrompts, useDefaultASR, useDefaultTTS, useDefaultTools, type DeploymentOption, type LLMService, type Prompt, type SimpleService, type Tool, type TransportOption, type TransportType } from "../api";
import { isSelectablePrompt, readLSArray, readLSString, writeLSString, writeLSJson, removeLSKey } from "../utils";
import { demoConfig } from "../config";
import { PRESETS, presetById, type PipelinePreset } from "../demo/presets";
import { AppContext } from "./app-context";

/** An editable prompt shown in the builder's prompt widget. */
export interface DemoPrompt {
  id: string;
  title: string;
  content: string;
  builtIn: boolean;
}

const ASR_STORAGE = "nvidia-voice-agent-asr-custom";
const TTS_STORAGE = "nvidia-voice-agent-tts-custom";
const LLM_STORAGE = "nvidia-voice-agent-llm-custom";
const ASR_SELECTION_STORAGE = "nvidia-voice-agent-asr-selection";
const TTS_SELECTION_STORAGE = "nvidia-voice-agent-tts-selection";
const LLM_SELECTION_STORAGE = "nvidia-voice-agent-llm-selection";
const PROMPT_STORAGE = "nvidia-voice-agent-prompts-custom";
const PROMPT_SELECTION = "nvidia-voice-agent-prompt-selection";
const TRANSPORT_STORAGE = "nvidia-voice-agent-transport";
const SELECTED_EXAMPLE_STORAGE = "nvidia-voice-agent-selected-example";
const ACTIVE_PRESET_STORAGE = "nva-active-preset";
const SELECTED_TOOLS_STORAGE = "nva-selected-tools";
const DEMO_PROMPTS_STORAGE = "nva-demo-prompts";
const ACTIVE_PROMPT_STORAGE = "nva-active-prompt";

/** Resolve a preset's catalog key (e.g. "nemotron-nano") to a live service id. */
function idForKey<T extends { id: string }>(items: T[], key: string | undefined): string | undefined {
  if (!key) return undefined;
  const match = items.find((i) => i.id === key || i.id.endsWith(`:${key}`) || i.id.split(":").pop() === key);
  return match?.id;
}

/** Seed the editable prompt list from the presets, applying any saved edits. */
function seedDemoPrompts(): DemoPrompt[] {
  const builtIns: DemoPrompt[] = PRESETS.map((p) => ({ id: p.id, title: p.title, content: p.promptContent, builtIn: true }));
  const saved = readLSArray<DemoPrompt>(DEMO_PROMPTS_STORAGE, []);
  if (!saved.length) return builtIns;
  // Saved list is authoritative (it already contains edited built-ins + customs),
  // but backfill any built-in the saved list is missing (e.g. a new preset shipped).
  const savedIds = new Set(saved.map((p) => p.id));
  return [...saved, ...builtIns.filter((b) => !savedIds.has(b.id))];
}

/** Fallback session language when an example declares none. */
export const DEFAULT_SESSION_LANGUAGE = "en-US";

type ManagedService = {
  id: string;
  builtIn: boolean;
};

function readCustomServices<T extends ManagedService>(key: string): T[] {
  return readLSArray<T>(key, []).map((service) => ({ ...service, builtIn: false }));
}

function getEffectiveSelectedId<T extends ManagedService>(
  selectedId: string,
  items: T[],
  loading: boolean,
  preferredBuiltInId = "",
): string {
  // User's explicit selection (built-in or custom) always wins.
  if (selectedId && items.some((item) => item.id === selectedId)) return selectedId;
  if (loading) return "";
  // Otherwise prefer the registry's declared default for this slot.
  if (preferredBuiltInId && items.some((item) => item.id === preferredBuiltInId)) return preferredBuiltInId;
  return items.find((item) => item.builtIn)?.id || items[0]?.id || "";
}

function getEffectivePromptKey(
  selectedKey: string,
  prompts: Prompt[],
  loading: boolean,
  preferredBuiltInKey = "",
): string {
  const selectablePrompts = prompts.filter(isSelectablePrompt);
  if (selectedKey && selectablePrompts.some((prompt) => prompt.key === selectedKey)) return selectedKey;
  if (loading) return "";
  if (preferredBuiltInKey && selectablePrompts.some((prompt) => prompt.key === preferredBuiltInKey)) {
    return preferredBuiltInKey;
  }
  return selectablePrompts.find((prompt) => prompt.default)?.key || selectablePrompts[0]?.key || "";
}

function getDefaultServiceId(selectedExample: DeploymentOption | undefined, slot: string): string {
  const entry = selectedExample?.defaults?.[slot]?.[0];
  return entry && "id" in entry && typeof entry.id === "string" ? entry.id : "";
}

function getDefaultPromptKey(selectedExample: DeploymentOption | undefined): string {
  const entry = selectedExample?.defaults?.prompt?.[0];
  return entry && "key" in entry && typeof entry.key === "string" ? entry.key : "";
}

type ManagedServiceCatalogOptions<T extends ManagedService> = {
  defaultItems: T[];
  loading: boolean;
  customStorageKey: string;
  selectionStorageKey: string;
  preferredBuiltInId?: string;
};

function useManagedServiceCatalog<T extends ManagedService>({
  defaultItems,
  loading,
  customStorageKey,
  selectionStorageKey,
  preferredBuiltInId = "",
}: ManagedServiceCatalogOptions<T>) {
  const [customItems, setCustomItems] = useState<T[]>(() => readCustomServices<T>(customStorageKey));
  const [selectedId, setSelectedId] = useState(() => readLSString(selectionStorageKey));

  const items = useMemo(() => [...defaultItems, ...customItems], [defaultItems, customItems]);

  const effectiveSelectedId = useMemo(
    () => getEffectiveSelectedId(selectedId, items, loading, preferredBuiltInId),
    [selectedId, items, loading, preferredBuiltInId],
  );

  const select = useCallback((id: string) => {
    setSelectedId(id);
    writeLSString(selectionStorageKey, id);
  }, [selectionStorageKey]);

  const persistCustom = useCallback((next: T[]) => {
    setCustomItems(next);
    writeLSJson(customStorageKey, next);
  }, [customStorageKey]);

  const clearSelection = useCallback(() => {
    setSelectedId("");
    removeLSKey(selectionStorageKey);
  }, [selectionStorageKey]);

  const removeCustom = useCallback((id: string) => {
    persistCustom(customItems.filter((item) => item.id !== id));
    if (effectiveSelectedId === id) {
      clearSelection();
    }
  }, [clearSelection, customItems, effectiveSelectedId, persistCustom]);

  const selected = useMemo(
    () => items.find((item) => item.id === effectiveSelectedId),
    [items, effectiveSelectedId],
  );

  return {
    customItems,
    items,
    selected,
    selectedId: effectiveSelectedId,
    select,
    persistCustom,
    removeCustom,
  };
}

export interface AppState {
  /** Currently selected example (server-provided). Undefined until /api/deployment resolves. */
  selectedExample: DeploymentOption | undefined;
  /** Switch to an option by its registry ``key`` (the example id). */
  selectExample: (key: string) => void;
  /** Full list of examples available on this deployment. */
  deploymentOptions: DeploymentOption[];

  /** Ask-before-connect: record this session to download afterward. */
  recordSession: boolean;
  setRecordSession: (v: boolean) => void;
  /** Consent: may this session's audio be stored (server-side) for quality/debugging. */
  storeConsent: boolean;
  setStoreConsent: (v: boolean) => void;
  /** LLM reasoning: the `enable_thinking` chat-template kwarg. Default is per selected model. */
  reasoning: boolean;
  setReasoning: (v: boolean) => void;
  /** Editable LLM base URL (empty = the pipeline's built-in default). */
  modelUrlOverride: string;
  setModelUrlOverride: (v: string) => void;
  /** Edited system prompt (empty = the example's original prompt). */
  promptOverride: string;
  setPromptOverride: (v: string) => void;

  /** The prebuilt pipeline preset currently loaded, if any. */
  activePresetId: string;
  activePreset: PipelinePreset | undefined;
  /** Load a preset: applies its prompt, tools, and preferred NIMs/voice. */
  applyPreset: (id: string) => void;

  /** Tools the pipeline will expose (composable in the builder). */
  selectedTools: string[];
  toggleTool: (name: string) => void;
  setSelectedTools: (names: string[]) => void;

  /** Editable prompt library shown in the builder's prompt widget. */
  demoPrompts: DemoPrompt[];
  activePromptId: string;
  activePrompt: DemoPrompt | undefined;
  selectDemoPrompt: (id: string) => void;
  updateDemoPrompt: (id: string, updates: { title?: string; content?: string }) => void;
  addDemoPrompt: (title: string, content: string) => string;
  removeDemoPrompt: (id: string) => void;

  /** When false, the server pinned a single bot — clients must not let the user switch examples. */
  deploymentSelectable: boolean;

  availableTransports: TransportOption[];
  selectedTransport: TransportType;
  setTransport: (t: TransportType) => void;
  currentSessionId: string;
  setCurrentSessionId: (id: string) => void;

  llms: LLMService[];
  llmsLoading: boolean;
  selectedLLMId: string;
  selectLLM: (id: string) => void;
  addLLM: (name: string, modelId: string, baseUrl: string, systemPrompt: string, extraParams: string) => LLMService;
  updateLLM: (id: string, updates: Partial<Omit<LLMService, "id" | "builtIn">>) => void;
  removeLLM: (id: string) => void;
  selectedLLM: LLMService | undefined;

  asrServices: SimpleService[];
  asrLoading: boolean;
  selectedASRId: string;
  selectASR: (id: string) => void;
  addASR: (name: string, server: string, model?: string) => SimpleService;
  updateASR: (id: string, updates: Partial<Omit<SimpleService, "id" | "builtIn">>) => void;
  removeASR: (id: string) => void;
  selectedASR: SimpleService | undefined;

  ttsServices: SimpleService[];
  ttsLoading: boolean;
  selectedTTSId: string;
  selectTTS: (id: string) => void;
  addTTS: (name: string, server: string, voiceId?: string) => SimpleService;
  updateTTS: (id: string, updates: Partial<Omit<SimpleService, "id" | "builtIn">>) => void;
  removeTTS: (id: string) => void;
  selectedTTS: SimpleService | undefined;

  selectedVoiceId: string;
  setSelectedVoiceId: (id: string) => void;

  /** The language the whole session is locked to when session language selection is enabled. */
  selectedSessionLanguage: string;
  setSelectedSessionLanguage: (code: string) => void;

  prompts: Prompt[];
  promptsLoading: boolean;
  selectedPromptKey: string;
  selectPrompt: (key: string) => void;
  addPrompt: (key: string, description: string, content: string) => string | null;
  updatePrompt: (key: string, description: string, content: string) => void;
  removePrompt: (key: string) => void;
  selectedPrompt: Prompt | undefined;

  tools: Tool[];
  toolsLoading: boolean;
}

export function AppProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { data: deployment } = useDeployment();
  const deploymentSelectable = deployment ? deployment.selectable : true;
  // Curated demo: restrict the exposed examples to the configured allow-list, in
  // allow-list order (so the featured example is first). Empty list = show all.
  const deploymentOptions = useMemo(() => {
    const all = deployment?.options ?? [];
    const allow = demoConfig.examples;
    if (!allow.length) return all;
    return allow
      .map((key) => all.find((option) => option.key === key))
      .filter((option): option is DeploymentOption => option !== undefined);
  }, [deployment]);

  // --- Selected example state (one source of truth, driven by /api/deployment) ---
  const [selectedKey, setSelectedKey] = useState<string>(() => readLSString(SELECTED_EXAMPLE_STORAGE));
  const selectExample = useCallback((key: string) => {
    setSelectedKey(key);
    writeLSString(SELECTED_EXAMPLE_STORAGE, key);
  }, []);

  const selectedExample = useMemo<DeploymentOption | undefined>(() => {
    if (!deployment) return undefined;
    if (!deployment.selectable) return deployment.active;
    return (
      deploymentOptions.find((option) => option.key === selectedKey)
      ?? deploymentOptions[0]
    );
  }, [deployment, selectedKey, deploymentOptions]);

  // --- Transport state ---
  const availableTransports = useMemo<TransportOption[]>(() => {
    return deployment?.transports ?? [];
  }, [deployment]);

  const [selectedTransport, setSelectedTransport] = useState<TransportType>(() => {
    return readLSString(TRANSPORT_STORAGE) === "websocket" ? "websocket" : "webrtc";
  });

  const effectiveTransport = useMemo<TransportType>(() => {
    if (availableTransports.some((transport) => transport.id === selectedTransport)) return selectedTransport;
    return availableTransports[0]?.id ?? selectedTransport;
  }, [selectedTransport, availableTransports]);

  useEffect(() => {
    if (availableTransports.length === 0 || effectiveTransport === selectedTransport) return;
    writeLSString(TRANSPORT_STORAGE, effectiveTransport);
  }, [availableTransports, effectiveTransport, selectedTransport]);

  const setTransport = useCallback((t: TransportType) => {
    setSelectedTransport(t);
    writeLSString(TRANSPORT_STORAGE, t);
  }, []);

  const [currentSessionId, setCurrentSessionId] = useState("");
  const [recordSession, setRecordSession] = useState(false);
  // Consent to store audio is opt-out: checked by default (user can uncheck to opt out).
  const [storeConsent, setStoreConsent] = useState(true);
  // Reasoning (enable_thinking): OFF by default and opt-in per session. The popup
  // resets it to the selected LLM's catalog default on every model switch, so this
  // initial value only applies before a model is chosen -- but it must still be
  // false, since a `true` here is exactly what leaked into Omni sessions and cost
  // ~8s of silent chain-of-thought per turn.
  const [reasoning, setReasoning] = useState(false);
  const [modelUrlOverride, setModelUrlOverride] = useState("");
  const [promptOverride, setPromptOverride] = useState("");

  // --- LLM state ---
  const serviceCatalogKey = selectedExample?.key ?? "";

  const { data: defaultLLMs = [], isLoading: llmsLoading } = useDefaultLLMs(serviceCatalogKey);
  const {
    customItems: customLLMs,
    items: llms,
    selectedId: effectiveSelectedLLMId,
    select: selectLLM,
    persistCustom: persistLLMs,
    removeCustom: removeLLM,
    selected: selectedLLM,
  } = useManagedServiceCatalog<LLMService>({
    defaultItems: defaultLLMs,
    loading: llmsLoading,
    customStorageKey: LLM_STORAGE,
    selectionStorageKey: LLM_SELECTION_STORAGE,
    preferredBuiltInId: getDefaultServiceId(selectedExample, "llm"),
  });

  const addLLM = useCallback((name: string, modelId: string, baseUrl: string, systemPrompt: string, extraParams: string) => {
    const svc: LLMService = { id: `custom-${crypto.randomUUID()}`, name, modelId, baseUrl, systemPrompt, extraParams, builtIn: false };
    persistLLMs([...customLLMs, svc]);
    return svc;
  }, [customLLMs, persistLLMs]);

  const updateLLM = useCallback((id: string, updates: Partial<Omit<LLMService, "id" | "builtIn">>) => {
    persistLLMs(customLLMs.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, [customLLMs, persistLLMs]);

  // --- ASR state ---
  const { data: defaultASR = [], isLoading: asrLoading } = useDefaultASR(serviceCatalogKey);
  const {
    customItems: customASR,
    items: asrServices,
    selectedId: effectiveSelectedASRId,
    select: selectASR,
    persistCustom: persistASR,
    removeCustom: removeASR,
    selected: selectedASR,
  } = useManagedServiceCatalog<SimpleService>({
    defaultItems: defaultASR,
    loading: asrLoading,
    customStorageKey: ASR_STORAGE,
    selectionStorageKey: ASR_SELECTION_STORAGE,
    preferredBuiltInId: getDefaultServiceId(selectedExample, "asr"),
  });

  const addASR = useCallback((name: string, server: string, model?: string) => {
    const svc: SimpleService = { id: `custom-asr-${crypto.randomUUID()}`, name, server, model, builtIn: false };
    persistASR([...customASR, svc]);
    return svc;
  }, [customASR, persistASR]);

  const updateASR = useCallback((id: string, updates: Partial<Omit<SimpleService, "id" | "builtIn">>) => {
    persistASR(customASR.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, [customASR, persistASR]);

  const [selectedVoiceId, setSelectedVoiceId] = useState("");

  const [selectedSessionLanguage, setSelectedSessionLanguage] = useState(DEFAULT_SESSION_LANGUAGE);
  const defaultSessionLanguageExampleKey = useRef("");
  const selectedExampleDefaultSessionLanguage = selectedExample?.default_session_language ?? DEFAULT_SESSION_LANGUAGE;

  useEffect(() => {
    const selectedExampleKey = selectedExample?.key ?? "";
    if (!selectedExampleKey || defaultSessionLanguageExampleKey.current === selectedExampleKey) return;
    defaultSessionLanguageExampleKey.current = selectedExampleKey;
    setSelectedSessionLanguage(selectedExampleDefaultSessionLanguage || DEFAULT_SESSION_LANGUAGE);
  }, [selectedExample?.key, selectedExampleDefaultSessionLanguage]);

  // --- TTS state ---
  const { data: defaultTTS = [], isLoading: ttsLoading } = useDefaultTTS(serviceCatalogKey);
  const {
    customItems: customTTS,
    items: ttsServices,
    selectedId: effectiveSelectedTTSId,
    select: selectTTSBase,
    persistCustom: persistTTS,
    removeCustom: removeTTS,
    selected: selectedTTS,
  } = useManagedServiceCatalog<SimpleService>({
    defaultItems: defaultTTS,
    loading: ttsLoading,
    customStorageKey: TTS_STORAGE,
    selectionStorageKey: TTS_SELECTION_STORAGE,
    preferredBuiltInId: getDefaultServiceId(selectedExample, "tts"),
  });

  const selectTTS = useCallback((id: string) => {
    selectTTSBase(id);
    setSelectedVoiceId("");
  }, [selectTTSBase]);

  const addTTS = useCallback((name: string, server: string, voiceId?: string) => {
    const svc: SimpleService = { id: `custom-tts-${crypto.randomUUID()}`, name, server, voiceId, builtIn: false };
    persistTTS([...customTTS, svc]);
    return svc;
  }, [customTTS, persistTTS]);

  const updateTTS = useCallback((id: string, updates: Partial<Omit<SimpleService, "id" | "builtIn">>) => {
    persistTTS(customTTS.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, [customTTS, persistTTS]);

  // --- Prompt state ---
  const { data: defaultPrompts = [], isLoading: promptsLoading } = useDefaultPrompts(serviceCatalogKey);
  const [customPrompts, setCustomPrompts] = useState<Prompt[]>(() => readLSArray<Prompt>(PROMPT_STORAGE, []).map((p) => ({ ...p, builtIn: false })));
  const [selectedPromptKey, setSelectedPromptKey] = useState(() => {
    try { return localStorage.getItem(PROMPT_SELECTION) || ""; } catch { return ""; }
  });

  const prompts = useMemo(() => [...defaultPrompts, ...customPrompts], [defaultPrompts, customPrompts]);

  const effectiveSelectedPromptKey = useMemo(
    () => getEffectivePromptKey(selectedPromptKey, prompts, promptsLoading, getDefaultPromptKey(selectedExample)),
    [selectedPromptKey, prompts, promptsLoading, selectedExample],
  );

  const persistPrompts = useCallback((next: Prompt[]) => {
    setCustomPrompts(next);
    writeLSJson(PROMPT_STORAGE, next);
  }, []);

  const selectPrompt = useCallback((key: string) => {
    setSelectedPromptKey(key);
    writeLSString(PROMPT_SELECTION, key);
  }, []);

  const addPrompt = useCallback((key: string, description: string, content: string): string | null => {
    const slug = key.trim().toLowerCase().replaceAll(/\s+/g, "_");
    if (prompts.some((p) => p.key === slug)) return `Prompt '${slug}' already exists`;
    persistPrompts([...customPrompts, { key: slug, description, content, builtIn: false }]);
    return null;
  }, [prompts, customPrompts, persistPrompts]);

  const updatePrompt = useCallback((key: string, description: string, content: string) => {
    persistPrompts(customPrompts.map((p) => (p.key === key ? { ...p, description, content } : p)));
  }, [customPrompts, persistPrompts]);

  const removePrompt = useCallback((key: string) => {
    persistPrompts(customPrompts.filter((p) => p.key !== key));
    if (effectiveSelectedPromptKey === key) setSelectedPromptKey("");
  }, [customPrompts, persistPrompts, effectiveSelectedPromptKey]);

  const selectedPrompt = useMemo(
    () => prompts.find((p) => p.key === effectiveSelectedPromptKey && isSelectablePrompt(p)),
    [prompts, effectiveSelectedPromptKey],
  );

  // --- Tools (read-only catalog from active example's tools.yaml) ---
  const { data: tools = [], isLoading: toolsLoading } = useDefaultTools(serviceCatalogKey);

  // Seed "all tools on" whenever the example changes (user toggles from there).
  const seededToolsFor = useRef<string>("");
  useEffect(() => {
    const key = selectedExample?.key ?? "";
    if (!key || toolsLoading) return;
    if (seededToolsFor.current !== key) {
      seededToolsFor.current = key;
      const all = tools.map((t) => t.name);
      setSelectedToolsState(all);
      writeLSJson(SELECTED_TOOLS_STORAGE, all);
    }
  }, [selectedExample, tools, toolsLoading]);

  // --- Demo: composable tool selection ---
  const [selectedTools, setSelectedToolsState] = useState<string[]>(
    () => readLSArray<string>(SELECTED_TOOLS_STORAGE, presetById(readLSString(ACTIVE_PRESET_STORAGE))?.tools ?? PRESETS[0].tools),
  );
  const setSelectedTools = useCallback((names: string[]) => {
    setSelectedToolsState(names);
    writeLSJson(SELECTED_TOOLS_STORAGE, names);
  }, []);
  const toggleTool = useCallback((name: string) => {
    setSelectedToolsState((prev) => {
      const next = prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name];
      writeLSJson(SELECTED_TOOLS_STORAGE, next);
      return next;
    });
  }, []);

  // --- Demo: editable prompt library ---
  const [demoPrompts, setDemoPrompts] = useState<DemoPrompt[]>(() => seedDemoPrompts());
  const [activePromptId, setActivePromptId] = useState<string>(
    () => readLSString(ACTIVE_PROMPT_STORAGE) || presetById(readLSString(ACTIVE_PRESET_STORAGE))?.id || PRESETS[0].id,
  );
  const selectDemoPrompt = useCallback((id: string) => {
    setActivePromptId(id);
    writeLSString(ACTIVE_PROMPT_STORAGE, id);
  }, []);
  const updateDemoPrompt = useCallback((id: string, updates: { title?: string; content?: string }) => {
    setDemoPrompts((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...updates } : p));
      writeLSJson(DEMO_PROMPTS_STORAGE, next);
      return next;
    });
  }, []);
  const addDemoPrompt = useCallback((title: string, content: string): string => {
    const id = `custom-prompt-${crypto.randomUUID()}`;
    setDemoPrompts((prev) => {
      const next = [...prev, { id, title: title.trim() || "Untitled prompt", content, builtIn: false }];
      writeLSJson(DEMO_PROMPTS_STORAGE, next);
      return next;
    });
    setActivePromptId(id);
    writeLSString(ACTIVE_PROMPT_STORAGE, id);
    return id;
  }, []);
  const removeDemoPrompt = useCallback((id: string) => {
    setDemoPrompts((prev) => {
      const next = prev.filter((p) => p.id !== id || p.builtIn);
      writeLSJson(DEMO_PROMPTS_STORAGE, next);
      return next;
    });
    setActivePromptId((cur) => (cur === id ? PRESETS[0].id : cur));
  }, []);
  const activePrompt = useMemo(() => demoPrompts.find((p) => p.id === activePromptId), [demoPrompts, activePromptId]);

  // --- Demo: active pipeline preset ---
  const [activePresetId, setActivePresetId] = useState<string>(() => readLSString(ACTIVE_PRESET_STORAGE) || PRESETS[0].id);
  const activePreset = useMemo(() => presetById(activePresetId), [activePresetId]);
  // A preset's preferred NIMs are resolved once the service catalogs load; this
  // holds a pending request so a preset applied before catalogs are ready still
  // takes effect (and is cleared afterward so it never fights manual edits).
  const [pendingPreset, setPendingPreset] = useState<PipelinePreset | null>(null);

  const applyPreset = useCallback((id: string) => {
    const preset = presetById(id);
    if (!preset) return;
    setActivePresetId(id);
    writeLSString(ACTIVE_PRESET_STORAGE, id);
    setSelectedTools(preset.tools);
    setActivePromptId(preset.id);
    writeLSString(ACTIVE_PROMPT_STORAGE, preset.id);
    if (preset.voiceId) setSelectedVoiceId(preset.voiceId);
    setPendingPreset(preset); // model selection resolves when catalogs are ready
  }, [setSelectedTools]);

  // Resolve a pending preset's preferred NIMs against the loaded catalogs.
  useEffect(() => {
    if (!pendingPreset) return;
    const llmId = idForKey(llms, pendingPreset.llmKey);
    const asrId = idForKey(asrServices, pendingPreset.asrKey);
    const ttsId = idForKey(ttsServices, pendingPreset.ttsKey);
    if (llmId) selectLLM(llmId);
    if (asrId) selectASR(asrId);
    if (ttsId) selectTTSBase(ttsId);
    // Clear once the catalogs have loaded (so we don't keep re-applying).
    if (!llmsLoading && !asrLoading && !ttsLoading) setPendingPreset(null);
  }, [pendingPreset, llms, asrServices, ttsServices, llmsLoading, asrLoading, ttsLoading, selectLLM, selectASR, selectTTSBase]);

  const value = useMemo<AppState>(() => ({
    selectedExample, selectExample, deploymentOptions,
    recordSession, setRecordSession, storeConsent, setStoreConsent, reasoning, setReasoning, modelUrlOverride, setModelUrlOverride, promptOverride, setPromptOverride,
    activePresetId, activePreset, applyPreset,
    selectedTools, toggleTool, setSelectedTools,
    demoPrompts, activePromptId, activePrompt, selectDemoPrompt, updateDemoPrompt, addDemoPrompt, removeDemoPrompt,
    deploymentSelectable,
    availableTransports,
    selectedTransport: effectiveTransport, setTransport,
    currentSessionId, setCurrentSessionId,
    llms, llmsLoading, selectedLLMId: effectiveSelectedLLMId, selectLLM, addLLM, updateLLM, removeLLM, selectedLLM,
    asrServices, asrLoading, selectedASRId: effectiveSelectedASRId, selectASR, addASR, updateASR, removeASR, selectedASR,
    ttsServices, ttsLoading, selectedTTSId: effectiveSelectedTTSId, selectTTS, addTTS, updateTTS, removeTTS, selectedTTS,
    selectedVoiceId, setSelectedVoiceId,
    selectedSessionLanguage, setSelectedSessionLanguage,
    prompts, promptsLoading, selectedPromptKey: effectiveSelectedPromptKey, selectPrompt, addPrompt, updatePrompt, removePrompt, selectedPrompt,
    tools, toolsLoading,
  }), [selectedExample, selectExample, deploymentOptions,
       recordSession, storeConsent, reasoning, modelUrlOverride, promptOverride,
       activePresetId, activePreset, applyPreset, selectedTools, toggleTool, setSelectedTools,
       demoPrompts, activePromptId, activePrompt, selectDemoPrompt, updateDemoPrompt, addDemoPrompt, removeDemoPrompt,
       deploymentSelectable, availableTransports, effectiveTransport, setTransport, currentSessionId,
       llms, llmsLoading, effectiveSelectedLLMId, selectLLM, addLLM, updateLLM, removeLLM, selectedLLM,
       asrServices, asrLoading, effectiveSelectedASRId, selectASR, addASR, updateASR, removeASR, selectedASR,
       ttsServices, ttsLoading, effectiveSelectedTTSId, selectTTS, addTTS, updateTTS, removeTTS, selectedTTS,
       selectedVoiceId, selectedSessionLanguage, setSelectedSessionLanguage,
       prompts, promptsLoading, effectiveSelectedPromptKey, selectPrompt, addPrompt, updatePrompt, removePrompt, selectedPrompt,
       tools, toolsLoading]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
