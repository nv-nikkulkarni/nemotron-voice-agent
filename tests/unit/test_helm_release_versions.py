# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Release metadata invariants for the NVCF and Viking Helm paths."""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CHART = ROOT / "nvcf_helm" / "Chart.yaml"
VALUES = ROOT / "nvcf_helm" / "values.yaml"
VIKING_VALUES = ROOT / "nvcf_helm" / "values-viking.yaml"

EXPECTED_CHART_VERSION = "0.1.130"
EXPECTED_APP_VERSION = "2.0.58"
EXPECTED_MAGPIE_IMAGE = "nvcr.io/nim/nvidia/magpie-tts-multilingual:1.10.0"
EXPECTED_CHATTERBOX_IMAGE = "nvcr.io/nim/nvidia/chatterbox-tts-multilingual:1.1.0"


def _load(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def test_release_metadata_and_environment_overlays_use_exact_app_artifact() -> None:
    """Keep every deployment path pinned to the same immutable app release."""
    chart = _load(CHART)
    values = _load(VALUES)
    viking_values = _load(VIKING_VALUES)

    assert str(chart["version"]) == EXPECTED_CHART_VERSION
    assert str(chart["appVersion"]) == EXPECTED_APP_VERSION
    assert str(values["appImage"]["tag"]) == EXPECTED_APP_VERSION
    assert str(viking_values["appImage"]["tag"]) == EXPECTED_APP_VERSION


def test_frontend_backend_uses_single_grounded_post_tool_response_by_default() -> None:
    """Prevent a second Talker inference from re-delegating completed work."""
    values = _load(VALUES)

    assert values["app"]["frontendBackendDirectToolResponse"] is True


def test_tts_nims_use_pinned_public_release_inputs() -> None:
    """Pin both selectable TTS services to explicit public NIM releases."""
    values = _load(VALUES)

    magpie = values["ttsImage"]
    chatterbox = values["chatterboxImage"]

    assert f"{magpie['repository']}:{magpie['tag']}" == EXPECTED_MAGPIE_IMAGE
    assert f"{chatterbox['repository']}:{chatterbox['tag']}" == EXPECTED_CHATTERBOX_IMAGE
    assert values["tts"]["nimTagsSelector"] == "batch_size=8"
    assert values["chatterboxTts"]["nimTagsSelector"] == "batch_size=8"
