# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Release-chart contracts for fail-closed session capture."""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
HELM_VALUES = ROOT / "nvcf_helm" / "values.yaml"
APP_DEPLOYMENT = ROOT / "nvcf_helm" / "templates" / "deployment-app.yaml"


def test_release_chart_requires_capture_upload() -> None:
    """Require NGC publication in the qualified release chart."""
    values = yaml.safe_load(HELM_VALUES.read_text(encoding="utf-8"))

    assert values["sessionCapture"]["enabled"] is True
    assert values["sessionCapture"]["uploadRequired"] is True


def test_chart_passes_required_flag_and_preserves_nonempty_destination() -> None:
    """Render the required flag without allowing an empty secret to erase a target."""
    deployment = APP_DEPLOYMENT.read_text(encoding="utf-8")

    assert "SESSION_CAPTURE_UPLOAD_REQUIRED" in deployment
    assert ".Values.sessionCapture.uploadRequired" in deployment
    assert 'if [ -n "$capture_ngc" ]; then' in deployment
    assert 'export SESSION_CAPTURE_NGC="$capture_ngc"' in deployment
    assert "export SESSION_CAPTURE_NGC=$(" not in deployment
