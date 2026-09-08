// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// A small, client-only history of completed demo sessions (persisted to
// localStorage). Powers the "Sessions" card so a visitor can see what they've
// tried this visit — story, pipeline, duration, and how it ended.

import { useCallback, useEffect, useState } from "react";
import { readLSArray, writeLSJson } from "../utils";

const HISTORY_STORAGE = "nvidia-voice-agent-session-history";
const MAX_HISTORY = 10;

export interface SessionRecord {
  sessionId: string;
  storyId?: string;
  storyTitle?: string;
  example?: string;
  durationSec?: number;
  endedReason?: string;
  transport?: string;
  /** epoch ms when the session ended. */
  endedAt: number;
}

export function useSessionHistory() {
  const [history, setHistory] = useState<SessionRecord[]>(() => readLSArray<SessionRecord>(HISTORY_STORAGE, []));

  // Keep multiple mounts / tabs roughly in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === HISTORY_STORAGE) setHistory(readLSArray<SessionRecord>(HISTORY_STORAGE, []));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const add = useCallback((record: SessionRecord) => {
    setHistory((prev) => {
      const next = [record, ...prev].slice(0, MAX_HISTORY);
      writeLSJson(HISTORY_STORAGE, next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
    writeLSJson(HISTORY_STORAGE, []);
  }, []);

  return { history, add, clear };
}
