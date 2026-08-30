// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

const compiledPath = process.env.CAPTURE_COORDINATOR_MODULE;
if (!compiledPath) throw new Error("CAPTURE_COORDINATOR_MODULE must point to compiled captureCoordinator.js");

const { flushSessionCapture, updateSessionCaptureSnapshot } = await import(
  pathToFileURL(compiledPath).href,
);

test("deduplicates an in-flight report and retries once until a 2xx acknowledgement", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(init);
    return new Response(null, { status: calls.length === 1 ? 503 : 204 });
  };
  try {
    updateSessionCaptureSnapshot("capture-retry", true, "User: hello");
    const first = flushSessionCapture("capture-retry");
    const duplicate = flushSessionCapture("capture-retry");
    assert.strictEqual(first, duplicate, "concurrent triggers must share one promise");

    const result = await first;
    assert.deepEqual(result, {
      acknowledged: true,
      attempts: 2,
      status: 204,
      outcome: "acknowledged",
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.keepalive, true);
    assert.equal(calls[1]?.keepalive, true);
    assert.deepEqual(JSON.parse(String(calls[1]?.body)), {
      session_id: "capture-retry",
      consent: true,
      transcript: "User: hello",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stops after exactly two failed attempts and never reports success", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 500 });
  };
  try {
    updateSessionCaptureSnapshot("capture-failed", true, "Assistant: retry me");
    const result = await flushSessionCapture("capture-failed");
    assert.deepEqual(result, {
      acknowledged: false,
      attempts: 2,
      status: 500,
      outcome: "failed",
    });
    const exhausted = await flushSessionCapture("capture-failed");
    assert.equal(exhausted.acknowledged, false);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("can become ready after an early flush and omits declined transcripts", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 200 });
  };
  try {
    const early = await flushSessionCapture("capture-declined");
    assert.equal(early.outcome, "not-ready");
    assert.equal(early.attempts, 0);

    updateSessionCaptureSnapshot("capture-declined", false, "must not leave browser");
    const result = await flushSessionCapture("capture-declined");
    assert.equal(result.acknowledged, true);
    assert.deepEqual(bodies, [{
      session_id: "capture-declined",
      consent: false,
      transcript: "",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
