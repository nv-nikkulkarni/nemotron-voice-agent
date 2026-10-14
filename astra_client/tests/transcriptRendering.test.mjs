// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

const compiledPath = process.env.TRANSCRIPT_RENDERING_MODULE;
if (!compiledPath) throw new Error("TRANSCRIPT_RENDERING_MODULE must point to compiled transcriptRendering.js");

const {
  joinSpokenAndUnspoken,
  renderConversationMessageText,
} = await import(pathToFileURL(compiledPath).href);

test("removes exact cumulative spoken/unspoken boundary overlap", () => {
  assert.equal(joinSpokenAndUnspoken("The weather is ", "is sunny."), "The weather is sunny.");
  assert.equal(joinSpokenAndUnspoken("Hello.", "Hello."), "Hello.");
});

test("does not fuzzy-delete legitimate repeated speech", () => {
  assert.equal(joinSpokenAndUnspoken("Go, go. ", "go again."), "Go, go. go again.");
  assert.equal(joinSpokenAndUnspoken("The model ", "the model repeats."), "The model the model repeats.");
});

test("renders scalar and cumulative conversation parts through one helper", () => {
  const message = {
    role: "assistant",
    createdAt: "2026-08-26T00:00:00Z",
    parts: [
      { text: "Stock: " },
      { text: { spoken: "NVIDIA is ", unspoken: "is 123 dollars." } },
      { text: 7 },
    ],
  };
  assert.equal(renderConversationMessageText(message), "Stock: NVIDIA is 123 dollars.7");
});
