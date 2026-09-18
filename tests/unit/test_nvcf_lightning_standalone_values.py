# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Release-contract tests for the standalone Lightning NVCF overlay."""

from pathlib import Path

import yaml

ROOT = Path(__file__).parents[2]
VALUES = ROOT / "nvcf_helm" / "values-lightning-standalone.yaml"


def _values() -> dict:
    return yaml.safe_load(VALUES.read_text(encoding="utf-8"))


def test_standalone_overlay_runs_only_lightning_workload():
    """The overlay must not start the voice app or any unrelated model/state service."""
    values = _values()

    assert values["nvcf"] is True
    assert values["nimReadyImmediate"] is False
    assert values["app"]["replicas"] == 0
    assert values["llmLightning"]["enabled"] is True
    assert values["llmLightning"]["vanilla"] is True
    assert values["llmLightning"]["cache"]["nvcf"] is True

    disabled_components = (
        "asr",
        "asrParakeet",
        "tts",
        "chatterboxTts",
        "llm",
        "llmSuper",
        "omni",
        "booking",
        "turn",
        "prewarm",
        "tracing",
        "sessionCapture",
        "sessionStore",
        "redis",
        "seaweedfs",
    )
    assert all(values[name]["enabled"] is False for name in disabled_components)


def test_standalone_overlay_uses_immutable_project_owned_nim_mirror():
    """NVCF must pull the native-blob project mirror rather than a mutable/public tag."""
    image = _values()["llmLightningImage"]

    assert image["repository"] == ("nvcr.io/0491162300748285/nemotron-lightning-selfcontained")
    assert image["tag"] == "2.0.9-variant"
    assert image["pullPolicy"] == "IfNotPresent"


def test_standalone_overlay_contains_no_inline_credentials():
    """Function-version credentials must remain outside checked-in Helm values."""
    text = VALUES.read_text(encoding="utf-8")

    assert "nvapi-" not in text
    assert "NGC_API_KEY:" not in text
    assert "NVIDIA_API_KEY:" not in text
