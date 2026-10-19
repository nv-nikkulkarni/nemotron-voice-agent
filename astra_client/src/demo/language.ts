// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

/** A language's name in the browser locale, e.g. "English (United States)" for en-US. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([navigator.language || "en"], { type: "language", languageDisplay: "standard" }).of(code) ?? code;
  } catch {
    return code;
  }
}
