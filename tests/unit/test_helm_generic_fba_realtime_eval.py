# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Contracts for the isolated Generic FBA Realtime evaluation overlay."""

# Test names describe the contract; separate public API docstrings add no value here.
# ruff: noqa: D103

import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).parents[2]
CHART = ROOT / "nvcf_helm"
BASE_VALUES = CHART / "values.yaml"
EVAL_VALUES = CHART / "values-generic-fba-realtime-eval.yaml"
APP_TEMPLATE = CHART / "templates" / "deployment-app.yaml"
LIGHTNING_TEMPLATE = CHART / "templates" / "deployment-llm-lightning.yaml"
HELPERS_TEMPLATE = CHART / "templates" / "_helpers.tpl"


def test_evaluation_overlay_raises_context_and_reduces_sequence_concurrency() -> None:
    base = yaml.safe_load(BASE_VALUES.read_text())
    overlay = yaml.safe_load(EVAL_VALUES.read_text())

    assert base["llmLightning"]["runtimeTuning"] is False
    assert overlay["llmLightning"] == {
        "enabled": True,
        "vanilla": True,
        "runtimeTuning": True,
        "nimKvCachePercent": "0.75",
        "nimMaxModelLen": "32768",
        "nimMaxNumSeqs": "16",
    }
    assert overlay["llmSuper"]["nimKvCachePercent"] == "0.75"
    assert overlay["llmSuper"]["nimMaxModelLen"] == "32768"
    assert overlay["llmSuper"]["nimMaxNumSeqs"] == "16"


def test_evaluation_overlay_bounds_generic_planning_and_client_execution() -> None:
    app = yaml.safe_load(EVAL_VALUES.read_text())["app"]

    assert app["example"] == "generic-frontend-backend-agent"
    assert app["transport"] == "websocket"
    assert app["genericThinkerMaxTokens"] == "2048"
    assert app["genericThinkerReasoningBudget"] == "1024"
    assert app["genericClientToolTimeoutSeconds"] == "25"
    assert app["replicas"] == 1
    assert app["realtimeAuthenticationRequired"] is True
    assert app["genericTalkerStreamTimeoutSeconds"] == "15"
    assert app["genericBackendTimeoutSeconds"] == "45"
    assert app["genericPlannerTimeoutSeconds"] == "15"
    assert app["genericPlannerMaxAttempts"] == "2"
    assert app["genericPlannerRetryBackoffSeconds"] == "0.5"

    template = APP_TEMPLATE.read_text()
    for variable in (
        "REALTIME_API_KEY",
        "GENERIC_TALKER_STREAM_TIMEOUT_SECONDS",
        "GENERIC_PLANNER_MAX_ATTEMPTS",
        "GENERIC_PLANNER_RETRY_BACKOFF_SECONDS",
        "GENERIC_CLIENT_TOOL_TIMEOUT_SECONDS",
        "GENERIC_THINKER_MAX_TOKENS",
        "GENERIC_THINKER_REASONING_BUDGET",
    ):
        assert variable in template


def test_lightning_runtime_tuning_never_restores_rejected_profile_selector() -> None:
    template = LIGHTNING_TEMPLATE.read_text()
    vanilla_block = template.split("{{- if .Values.llmLightning.vanilla }}", 1)[1].split(
        "{{- else }}",
        1,
    )[0]

    assert "NIM_KVCACHE_PERCENT" in vanilla_block
    assert "NIM_MAX_MODEL_LEN" in vanilla_block
    assert "--max-num-seqs" in vanilla_block
    assert "- name: NIM_TAGS_SELECTOR" not in vanilla_block


def test_evaluation_overlay_renders_only_the_requested_runtime_components() -> None:
    overlay = yaml.safe_load(EVAL_VALUES.read_text())

    for component in ("asr", "tts", "llmLightning", "llmSuper", "prewarm"):
        assert overlay[component]["enabled"] is True
    for component in (
        "llm",
        "omni",
        "chatterboxTts",
        "asrParakeet",
        "booking",
        "sessionCapture",
        "redis",
        "sessionStore",
        "turn",
        "tracing",
    ):
        assert overlay[component]["enabled"] is False

    assert overlay["appImage"]["tag"] == "2.0.69"


def test_nvcf_nims_prefer_the_dedicated_model_download_key() -> None:
    helper = HELPERS_TEMPLATE.read_text()
    ngc_lookup = helper.index('"NGC_API_KEY"[[:space:]]*')
    legacy_lookup = helper.index('"NVIDIA_API_KEY"[[:space:]]*', ngc_lookup)

    assert ngc_lookup < legacy_lookup


def test_helm_render_has_only_minimal_realtime_workloads() -> None:
    if shutil.which("helm") is None:
        pytest.skip("helm is not installed")

    rendered = subprocess.run(
        ["helm", "template", "generic-fba-realtime", str(CHART), "-f", str(EVAL_VALUES)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    documents = [document for document in yaml.safe_load_all(rendered) if document]
    resources = {(document["kind"], document["metadata"]["name"]) for document in documents}
    deployments = {name for kind, name in resources if kind == "Deployment"}

    assert deployments == {
        "generic-fba-realtime-nemotron-voice-agent",
        "generic-fba-realtime-nemotron-voice-agent-asr",
        "generic-fba-realtime-nemotron-voice-agent-llm-lightning",
        "generic-fba-realtime-nemotron-voice-agent-llm-super",
        "generic-fba-realtime-nemotron-voice-agent-prewarmer",
        "generic-fba-realtime-nemotron-voice-agent-tts",
    }
    for forbidden in ("redis", "seaweedfs", "omni", "chatterbox", "booking", "parakeet", "session-data"):
        assert all(forbidden not in name for _, name in resources)

    app = next(
        document
        for document in documents
        if document["kind"] == "Deployment"
        and document["metadata"]["name"] == "generic-fba-realtime-nemotron-voice-agent"
    )
    container = app["spec"]["template"]["spec"]["containers"][0]
    env = {item["name"]: item.get("value") for item in container["env"]}
    assert container["image"].endswith(":2.0.69")
    assert env["EXAMPLE_SELECTION"] == "generic-frontend-backend-agent"
    assert env["TRANSPORT_SELECTION"] == "websocket"
    assert env["GENERIC_TALKER_STREAM_TIMEOUT_SECONDS"] == "15"
    assert env["GENERIC_BACKEND_TIMEOUT_SECONDS"] == "45"
    assert env["GENERIC_PLANNER_TIMEOUT_SECONDS"] == "15"
    assert env["GENERIC_PLANNER_MAX_ATTEMPTS"] == "2"
    assert env["GENERIC_PLANNER_RETRY_BACKOFF_SECONDS"] == "0.5"
    assert not any(name.startswith(("SESSION_CAPTURE", "SESSION_STORE", "REDIS_")) for name in env)
    assert "REALTIME_API_KEY" in "\n".join(container["command"])
