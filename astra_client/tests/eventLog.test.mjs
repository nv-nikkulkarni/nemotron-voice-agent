// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

const compiledPath = process.env.EVENT_LOG_MODULE;
if (!compiledPath) throw new Error("EVENT_LOG_MODULE must point to compiled eventLog.js");
const { appendEvent, describeToolCall } = await import(pathToFileURL(compiledPath).href);

test("describes tool calls with their subject", () => {
  assert.equal(describeToolCall("get_weather", { city: "Tokyo" }), "Weather tool called for Tokyo");
  assert.equal(describeToolCall("get_stock_price", { symbol: "NVDA" }), "Stock price tool called for NVDA");
  assert.equal(describeToolCall("get_current_date_time"), "Current date time tool called");
  assert.equal(describeToolCall(undefined), "Tool called");
});

test("keeps only the newest events up to the limit", () => {
  let events = [];
  for (let i = 0; i < 10; i += 1) events = appendEvent(events, { at: i * 5000, kind: "user", text: `e${i}` }, 3, i + 1);
  assert.deepEqual(events.map((event) => event.text), ["e7", "e8", "e9"]);
});

test("collapses duplicate reports of one tool call, keeping the richer line", () => {
  let events = appendEvent([], { at: 1000, kind: "tool", text: "Weather tool called" }, 50, 1);
  events = appendEvent(events, { at: 1200, kind: "tool", text: "Weather tool called for Tokyo" }, 50, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0].text, "Weather tool called for Tokyo");
  events = appendEvent(events, { at: 9000, kind: "tool", text: "Weather tool called for Paris" }, 50, 3);
  assert.equal(events.length, 2);
});
