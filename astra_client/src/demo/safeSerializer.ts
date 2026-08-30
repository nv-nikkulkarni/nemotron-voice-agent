// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Why this exists
// ---------------
// The server runs pipecat-ai 1.5.0, whose protobuf `Frame` oneof defines five
// members: text=1, audio=2, transcription=3, message=4, **interruption=5**
// (InterruptionFrame, added in 1.5.0). The bundled client — @pipecat-ai/
// websocket-transport 1.7.0 (client-js 1.12.0) — ships an OLDER proto that only
// knows fields 1–4, and its `deserialize()` handles only `audio` and `message`,
// throwing `Error("Unknown frame kind")` on anything else.
//
// So on every session the server emits one InterruptionFrame (barge-in / greeting
// interruption) and the client logs:
//     Failed to deserialize incoming message: Unknown frame kind
// Bot audio arrives as `audio` frames and the corresponding user-speech signal
// arrives as an RTVI `message` frame. App.tsx wires that public RTVI callback to
// the media manager's `userStartedSpeaking()` method so queued browser audio is
// interrupted. The raw InterruptionFrame can therefore remain a compatibility
// no-op until the client package's generated protobuf includes field 5.
//
// This subclass delegates to the stock serializer and, ONLY for that specific
// "Unknown frame kind" throw, returns a benign object. The transport's receive
// loop already ignores any `parsed.type` that isn't "audio" or "message", so the
// benign value is a functional no-op — it just stops the error from being logged.
// Genuine failures (bad data, "Unknown data type") are re-thrown unchanged.
import { ProtobufFrameSerializer } from "@pipecat-ai/websocket-transport";

export class SafeProtobufFrameSerializer extends ProtobufFrameSerializer {
  async deserialize(data: unknown) {
    try {
      return await super.deserialize(data as never);
    } catch (e) {
      if (e instanceof Error && e.message === "Unknown frame kind") {
        // Frame kinds this client's proto doesn't model (e.g. pipecat 1.5.0's
        // InterruptionFrame). Skip silently — the caller no-ops on this type.
        return { type: "interruption" } as never;
      }
      throw e;
    }
  }
}
