// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

export const DEFAULT_SESSION_SECONDS = 5 * 60;

export function normalizeSessionSeconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SESSION_SECONDS;
  return Math.max(1, Math.floor(parsed));
}

export function remainingSessionSeconds(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function formatSessionTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function sessionTimerTone(remainingSeconds: number): "" | "low" | "critical" {
  if (remainingSeconds <= 15) return "critical";
  if (remainingSeconds <= 60) return "low";
  return "";
}
