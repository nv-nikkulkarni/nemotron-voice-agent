// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Architecture diagrams ship with the UI; the backend still names them generic.svg and
// omni.svg. The panel opens either on the agent's request or from the conversation button.

export const BUNDLED_ARCHITECTURE_IMAGES: Record<string, string> = {
  "/api/architecture/generic.svg": "/architecture-generic.png",
  "/api/architecture/omni.svg": "/architecture-omni.png",
};

const SHOW_EVENT = "nva:show-architecture";

export function architectureImageFor(exampleKey: string | undefined): string {
  return /omni/i.test(exampleKey ?? "") ? "/architecture-omni.png" : "/architecture-generic.png";
}

export function requestArchitecture(image: string): void {
  window.dispatchEvent(new CustomEvent<string>(SHOW_EVENT, { detail: image }));
}

export function onArchitectureRequest(handler: (image: string) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<string>).detail);
  window.addEventListener(SHOW_EVENT, listener);
  return () => window.removeEventListener(SHOW_EVENT, listener);
}
