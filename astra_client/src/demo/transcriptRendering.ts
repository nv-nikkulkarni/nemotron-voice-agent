// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import type { ConversationMessage, ConversationMessagePart } from "@pipecat-ai/client-react";

function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** Join cumulative spoken/unspoken text by removing only an exact boundary overlap. */
export function joinSpokenAndUnspoken(spoken: string, unspoken: string): string {
  if (!spoken) return unspoken;
  if (!unspoken) return spoken;
  const maxOverlap = Math.min(spoken.length, unspoken.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (spoken.slice(-size) === unspoken.slice(0, size)) {
      return spoken + unspoken.slice(size);
    }
  }
  return spoken + unspoken;
}

/** Render one Pipecat conversation part without duplicating cumulative speech. */
export function renderConversationPartText(part: ConversationMessagePart): string {
  const { text } = part;
  const scalar = scalarText(text);
  if (scalar || text === "") return scalar;
  if (typeof text !== "object" || text === null) return "";
  const objectText = text as unknown as Record<string, unknown>;
  if (!("spoken" in objectText) && !("unspoken" in objectText)) return "";
  return joinSpokenAndUnspoken(
    scalarText(objectText.spoken),
    scalarText(objectText.unspoken),
  );
}

/** Shared renderer used by the visible panel and capture reporter. */
export function renderConversationMessageText(message: ConversationMessage): string {
  return message.parts.map(renderConversationPartText).join("");
}
