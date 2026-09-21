# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Focused tests for Generic FBA Realtime client-tool suspend/resume."""

# Test names describe the contract; separate public API docstrings add no value here.
# ruff: noqa: D101, D102

from __future__ import annotations

import asyncio
import json
import unittest

from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection
from realtime_helpers import FakeWebSocket

from examples.frontend_backend_agent.generic.client_tools import (
    build_client_tool_specs,
    client_call_fingerprint,
)
from examples.frontend_backend_agent.generic.dispatcher import dispatch_plan
from realtime.client_tools import ClientToolBroker, ClientToolTimeoutResult
from realtime.controller import RealtimeSessionController
from realtime.frames import RealtimeClientToolOutputFrame
from realtime.session import RealtimeSessionCapabilities
from realtime.transport import (
    bind_realtime_context,
    create_realtime_transport,
    realtime_client_tool_executor,
    realtime_response_gate_processors,
    realtime_tool_result_processors,
    shutdown_realtime_transport,
)


def _client_schema(name: str = "lookup") -> dict:
    return {
        "type": "function",
        "name": name,
        "description": "Look up a record by id.",
        "parameters": {
            "type": "object",
            "properties": {"record_id": {"type": "string"}},
            "required": ["record_id"],
            "additionalProperties": False,
        },
    }


class DirectClientToolBrokerTests(unittest.IsolatedAsyncioTestCase):
    async def test_direct_call_waits_for_release_and_marks_context_applied(self) -> None:
        broker = ClientToolBroker(output_timeout_secs=5)
        await broker.register_direct_calls((("call-1", "lookup"),), timeout_secs=1)
        waiter = asyncio.create_task(broker.wait_direct_output(call_id="call-1", name="lookup"))

        await broker.stage_output(call_id="call-1", name="lookup", output='{"answer":"found"}')
        self.assertFalse(waiter.done())
        await broker.release_output(call_id="call-1", name="lookup")

        self.assertEqual(await waiter, '{"answer":"found"}')
        await broker.wait_context_applied("call-1", timeout=0.2)
        self.assertEqual(broker.pending_context_call_ids(), ())

    async def test_direct_call_has_a_bounded_timeout_and_rejects_late_output(self) -> None:
        broker = ClientToolBroker(output_timeout_secs=5)
        await broker.register_direct_calls((("call-timeout", "lookup"),), timeout_secs=0.01)

        result = await broker.wait_direct_output(call_id="call-timeout", name="lookup")

        self.assertIsInstance(result, ClientToolTimeoutResult)
        with self.assertRaisesRegex(Exception, "deadline"):
            await broker.stage_output(call_id="call-timeout", name="lookup", output="late")


class RealtimeClientToolRoundContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_pipeline_created_round_surfaces_and_resumes_through_wire_output(self) -> None:
        websocket = FakeWebSocket([])
        voice = "Magpie-Multilingual.EN-US.Aria"
        controller = RealtimeSessionController(
            model="nvidia/nemotron-realtime-generic-frontend-backend",
            voice=voice,
            runtime_config={"pipeline_mode": "generic-frontend-backend-agent"},
            capabilities=RealtimeSessionCapabilities(voices=frozenset({voice}), function_tools=True),
        )
        controller.apply_session_update(
            {
                "output_modalities": ["text"],
                "tools": [_client_schema()],
            }
        )
        controller.bind_session_tool_projection(
            client_tool_bindings={"lookup": "lookup"},
            mcp_pipeline_names=frozenset(),
        )
        transport = create_realtime_transport(websocket, controller=controller)
        [response_gate] = realtime_response_gate_processors(transport)
        bind_realtime_context(transport, LLMContext([]))
        realtime_tool_result_processors(transport)
        executor = realtime_client_tool_executor(transport)
        self.assertIsNotNone(executor)

        try:
            round_task = asyncio.create_task(executor((("lookup", {"record_id": "one"}),), 1.0))
            for _attempt in range(100):
                done_events = [
                    event for event in websocket.sent if event.get("type") == "response.function_call_arguments.done"
                ]
                if done_events:
                    break
                await asyncio.sleep(0.005)
            self.assertEqual(len(done_events), 1)
            call_event = done_events[0]
            output_frame = await transport.input()._params.serializer.deserialize(
                json.dumps(
                    {
                        "type": "conversation.item.create",
                        "item": {
                            "type": "function_call_output",
                            "call_id": call_event["call_id"],
                            "output": '{"ok":true,"answer":"found"}',
                        },
                    }
                )
            )
            self.assertIsInstance(output_frame, RealtimeClientToolOutputFrame)
            await response_gate.process_frame(output_frame, FrameDirection.DOWNSTREAM)

            self.assertEqual(
                await asyncio.wait_for(round_task, timeout=1.0),
                ['{"ok":true,"answer":"found"}'],
            )
            event_types = [event.get("type") for event in websocket.sent]
            self.assertIn("response.created", event_types)
            self.assertIn("response.output_item.done", event_types)
            self.assertIn("response.done", event_types)
            self.assertIn("conversation.item.added", event_types)
            self.assertIn("conversation.item.done", event_types)
        finally:
            shutdown_realtime_transport(transport)

    async def test_live_generic_planner_policy_update_requires_reconnect(self) -> None:
        websocket = FakeWebSocket([])
        voice = "Magpie-Multilingual.EN-US.Aria"
        controller = RealtimeSessionController(
            model="nvidia/nemotron-realtime-generic-frontend-backend",
            voice=voice,
            runtime_config={"pipeline_mode": "generic-frontend-backend-agent"},
            capabilities=RealtimeSessionCapabilities(voices=frozenset({voice}), function_tools=True),
        )
        transport = create_realtime_transport(websocket, controller=controller)
        realtime_response_gate_processors(transport)
        bind_realtime_context(transport, LLMContext([]))
        try:
            frame = await transport.input()._params.serializer.deserialize(
                json.dumps(
                    {
                        "type": "session.update",
                        "session": {"instructions": "Replace the domain policy."},
                    }
                )
            )
            self.assertIsNone(frame)
            self.assertEqual(websocket.sent[-1]["type"], "error")
            self.assertEqual(websocket.sent[-1]["error"]["code"], "unsupported_live_session_update")
            self.assertEqual(websocket.sent[-1]["error"]["param"], "session.instructions")
            self.assertEqual(controller.public_session()["instructions"], "")
        finally:
            shutdown_realtime_transport(transport)


class GenericClientToolDispatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_client_schema_is_validated_then_one_batch_is_executed(self) -> None:
        specs = build_client_tool_specs((_client_schema(), _client_schema("second")))
        batches: list[tuple[tuple[str, dict], ...]] = []

        async def execute(calls, _timeout):
            batches.append(calls)
            return ['{"answer":"first"}', "second result"]

        accumulated: list[dict] = []
        payload = await dispatch_plan(
            {
                "tool_calls": [
                    {"tool": "lookup", "params": {"record_id": "one"}},
                    {"tool": "second", "params": {"record_id": "two"}},
                ]
            },
            {},
            ("lookup", "second"),
            client_tools=specs,
            client_tool_executor=execute,
            accumulated_results=accumulated,
            seen_client_calls=set(),
        )

        self.assertEqual(len(batches), 1)
        self.assertEqual([name for name, _arguments in batches[0]], ["lookup", "second"])
        self.assertEqual(payload["tool"], "multi_tool")
        self.assertEqual([item["status"] for item in accumulated], ["success", "success"])

    async def test_invalid_arguments_fail_before_client_execution(self) -> None:
        specs = build_client_tool_specs((_client_schema(),))
        called = False

        async def execute(_calls, _timeout):
            nonlocal called
            called = True
            return []

        payload = await dispatch_plan(
            {"tool": "lookup", "params": {}},
            {},
            ("lookup",),
            client_tools=specs,
            client_tool_executor=execute,
        )

        self.assertFalse(called)
        self.assertEqual(payload["reason"], "params_invalid")

    async def test_duplicate_in_one_client_batch_is_rejected_before_wire_execution(self) -> None:
        specs = build_client_tool_specs((_client_schema(),))
        called = False

        async def execute(_calls, _timeout):
            nonlocal called
            called = True
            return []

        seen: set[str] = set()
        payload = await dispatch_plan(
            {
                "tool_calls": [
                    {"tool": "lookup", "params": {"record_id": "one"}},
                    {"tool": "lookup", "params": {"record_id": "one"}},
                ]
            },
            {},
            ("lookup",),
            client_tools=specs,
            client_tool_executor=execute,
            seen_client_calls=seen,
        )

        self.assertFalse(called)
        self.assertEqual(seen, {client_call_fingerprint("lookup", {"record_id": "one"})})
        self.assertEqual(payload["status"], "unavailable")
        self.assertIn("repeated tool request", payload["response_text"])

    async def test_failed_duplicate_is_suppressed_without_another_wire_round(self) -> None:
        specs = build_client_tool_specs((_client_schema(),))
        arguments = {"record_id": "one"}
        seen = {client_call_fingerprint("lookup", arguments)}
        called = False

        async def execute(_calls, _timeout):
            nonlocal called
            called = True
            return []

        payload = await dispatch_plan(
            {"tool": "lookup", "params": arguments},
            {},
            ("lookup",),
            client_tools=specs,
            client_tool_executor=execute,
            seen_client_calls=seen,
        )

        self.assertFalse(called)
        self.assertEqual(payload["status"], "unavailable")
        self.assertIn("repeated tool request", payload["response_text"])


if __name__ == "__main__":
    unittest.main()
