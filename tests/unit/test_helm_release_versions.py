# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Release metadata invariants for the NVCF and Viking Helm paths."""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CHART = ROOT / "nvcf_helm" / "Chart.yaml"
VALUES = ROOT / "nvcf_helm" / "values.yaml"
VIKING_VALUES = ROOT / "nvcf_helm" / "values-viking.yaml"

EXPECTED_CHART_VERSION = "0.1.143-dev.20261017.1"
EXPECTED_APP_VERSION = "2.0.68"
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


def test_frontend_backend_uses_release_modes_and_ordered_deadlines() -> None:
    """Keep filler/result behavior explicit and leave room for grounded timeout speech."""
    values = _load(VALUES)
    app = values["app"]

    assert app["frontendBackendTalkerFillerMode"] == "emit"
    assert "frontendBackendToolResultMode" not in app
    assert "frontendBackendDirectToolResponse" not in app
    outer = float(app["thinkerToolTimeoutSeconds"])
    overall = float(app["genericBackendTimeoutSeconds"])
    planner = float(app["genericPlannerTimeoutSeconds"])
    web = float(app["genericWebSearchTimeoutSeconds"])
    assert outer == 45.0
    assert overall == 40.0
    assert planner == 18.0
    assert web == 20.0
    assert outer > overall > max(planner, web)

    template = (ROOT / "nvcf_helm" / "templates" / "deployment-app.yaml").read_text()
    for name in (
        "FRONTEND_BACKEND_TALKER_FILLER_MODE",
        "THINKER_TOOL_TIMEOUT_SECONDS",
        "GENERIC_BACKEND_TIMEOUT_SECONDS",
        "GENERIC_PLANNER_TIMEOUT_SECONDS",
        "GENERIC_WEB_SEARCH_TIMEOUT_SECONDS",
    ):
        assert name in template


def test_tts_nims_use_pinned_public_release_inputs() -> None:
    """Pin both selectable TTS services to explicit public NIM releases."""
    values = _load(VALUES)

    magpie = values["ttsImage"]
    chatterbox = values["chatterboxImage"]

    assert f"{magpie['repository']}:{magpie['tag']}" == EXPECTED_MAGPIE_IMAGE
    assert f"{chatterbox['repository']}:{chatterbox['tag']}" == EXPECTED_CHATTERBOX_IMAGE
    assert values["tts"]["nimTagsSelector"] == "batch_size=8"
    assert values["chatterboxTts"]["nimTagsSelector"] == "batch_size=8"


def test_app_and_ui_images_accept_immutable_release_labels() -> None:
    """Require both release images to record the complete source revision."""
    app_dockerfile = (ROOT / "docker" / "Dockerfile").read_text()
    ui_dockerfile = (ROOT / "docker" / "Dockerfile.nvcf-ui").read_text()

    assert "ARG APP_VERSION=unknown" in app_dockerfile
    assert "LABEL org.opencontainers.image.version=${APP_VERSION}" in app_dockerfile
    assert "LABEL org.opencontainers.image.revision=${SOURCE_SHA}" in app_dockerfile
    assert "ARG UI_VERSION=unknown" in ui_dockerfile
    assert "LABEL org.opencontainers.image.version=${UI_VERSION}" in ui_dockerfile
    assert "LABEL org.opencontainers.image.revision=${SOURCE_SHA}" in ui_dockerfile


def _rendered_gpu_total(*extra_args: str) -> int:
    import shutil
    import subprocess

    import pytest

    if shutil.which("helm") is None:
        pytest.skip("helm is not installed")
    rendered = subprocess.run(
        ["helm", "template", "gpu-check", str(ROOT / "nvcf_helm"), *extra_args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    total = 0
    for doc in yaml.safe_load_all(rendered):
        if not doc or doc.get("kind") != "Deployment":
            continue
        for container in doc["spec"]["template"]["spec"]["containers"]:
            total += int(container.get("resources", {}).get("limits", {}).get("nvidia.com/gpu", 0))
    return total


def test_default_and_viking_renders_fit_an_eight_gpu_node() -> None:
    """The NVCF function and the Viking node both have 8 GPUs; the chart must not request more."""
    assert _rendered_gpu_total() <= 8
    assert _rendered_gpu_total("-f", str(VIKING_VALUES)) <= 8
