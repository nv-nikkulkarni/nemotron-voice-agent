// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// When the pipecat WebSocket transport hits a fatal error mid-connect (before begin()
// completes), it tears itself down and calls end() on a session that never began —
// surfacing as an orphaned "Session ended: please call .begin() first" promise rejection
// (plus a scary "Uncaught (in promise)" console error). It's benign: useSessionLifecycle
// recovers the UI to idle on the same terminal transport state. Swallow just that one
// rejection so it doesn't read as a fatal error. Installed once, before any client exists.

let installed = false;

export function installConnectGuards(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string } | string | undefined;
    const msg = typeof r === "string" ? r : (r?.message ?? "");
    if (msg.includes("please call .begin() first")) {
      e.preventDefault(); // benign: transport tore down a never-begun session
    }
  });
}
