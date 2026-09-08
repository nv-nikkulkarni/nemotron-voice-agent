// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Runtime demo configuration.
//
// The nvcf-ui container's entrypoint writes /config.js which sets
// `window.__DEMO_CONFIG__` before the app bundle loads, so the same static
// build can be re-tuned per deployment without a rebuild. In dev, public/config.js
// ships an empty object and the defaults below apply.

export interface FeedbackFieldMap {
  /** Google Form entry.<id> for the star rating (1-5). */
  rating?: string;
  /** entry.<id> for free-text comments. */
  comments?: string;
  /** entry.<id> for the selected example key. */
  example?: string;
  /** entry.<id> for the backend session id. */
  sessionId?: string;
  /** entry.<id> for the "what went wrong" tags (comma-joined). */
  tags?: string;
  /** entry.<id> for extra session metadata (JSON). */
  metadata?: string;
}

export interface DemoConfig {
  /** UTC timestamp baked into the UI image for an at-a-glance rollout reference. */
  deployedAt: string;
  /** Master switch for the curated-demo UI (timer, curated prompts, feedback, record). */
  demoMode: boolean;
  /** Hard session cap in seconds; a 2:00 -> 0:00 countdown that force-disconnects. */
  sessionSeconds: number;
  /** Allow-list of example keys to expose. Empty = show all. */
  examples: string[];
  /** Show only locally self-hosted models under services (hide cloud-nim). */
  selfHostedOnly: boolean;
  /** Show the opt-in Record button. */
  recordEnabled: boolean;
  /** Container format for recordings ("webm" is universally supported by MediaRecorder). */
  recordFormat: "webm";
  /**
   * Graceful, interruptible End: run verified teardown (close WS, release mic,
   * flush audio, finalize recorder) behind a "stopping" overlay, and make a
   * reconnect await the in-flight teardown. false = legacy instant end.
   */
  gracefulTeardown: boolean;
  /**
   * Deliberate grace window (ms) after End: keep the "Ending…" buffering overlay
   * up and let the stream close for at least this long before the thank-you modal.
   */
  teardownGraceMs: number;
  /** Feedback destination — a Google Form. */
  feedback: {
    /** Full formResponse URL, e.g. https://docs.google.com/forms/d/e/<ID>/formResponse. Empty = feedback disabled. */
    formUrl: string;
    /** Map of our fields -> Google Form entry.<id> names. */
    fields: FeedbackFieldMap;
  };
}

const DEFAULTS: DemoConfig = {
  deployedAt: "",
  demoMode: true,
  sessionSeconds: 120,
  examples: ["generic-frontend-backend-agent", "omni-assistant-subagents"],
  selfHostedOnly: true,
  recordEnabled: true,
  recordFormat: "webm",
  gracefulTeardown: true,
  teardownGraceMs: 1500,
  feedback: {
    // Same-origin path only. The nvcf-ui nginx proxies /feedback to the real
    // Google Form URL, which is kept server-side (deploy-time env) and NEVER
    // shipped in the client bundle. The entry.<id> field names below are not
    // secret (they can't read responses) and are needed to build the form body.
    formUrl: "/feedback",
    fields: {
      rating: "entry.1783359898",
      comments: "entry.846695298",
      example: "entry.1350663230",
      sessionId: "entry.1300159054",
      tags: "entry.75342959",
      metadata: "entry.1599000110",
    },
  },
};

declare global {
  interface Window {
    __DEMO_CONFIG__?: Partial<DemoConfig>;
  }
}

function readRuntimeConfig(): DemoConfig {
  const raw = (typeof window !== "undefined" && window.__DEMO_CONFIG__) || {};
  return {
    ...DEFAULTS,
    ...raw,
    feedback: {
      ...DEFAULTS.feedback,
      ...(raw.feedback ?? {}),
      fields: { ...DEFAULTS.feedback.fields, ...(raw.feedback?.fields ?? {}) },
    },
  };
}

/** Frozen, resolved demo config read once at module load. */
export const demoConfig: DemoConfig = readRuntimeConfig();

/** True when a service entry should be shown given selfHostedOnly. */
export function isServiceVisible(source: unknown): boolean {
  if (!demoConfig.selfHostedOnly) return true;
  return source === "self-hosted";
}
