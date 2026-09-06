# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Tests for shared pipeline construction helpers."""

# ruff: noqa: D101, D102

import os
import unittest
from unittest.mock import patch

from examples.shared.pipeline_utils import build_user_aggregator_params


class _FakeVADAnalyzer:
    def __init__(self, *, params):
        self.params = params


class UserAggregatorParamsTests(unittest.TestCase):
    def _build(self, *, use_silero: bool, vad_stop_secs: float | None = None):
        env = {
            "USE_SILERO_VAD_TURN_DETECTION": str(use_silero).lower(),
            "SILERO_VAD_STOP_SECS": "0.9",
        }
        with (
            patch.dict(os.environ, env),
            patch(
                "examples.shared.pipeline_utils.SileroVADAnalyzer",
                side_effect=_FakeVADAnalyzer,
            ),
            patch(
                "examples.shared.pipeline_utils.build_smart_turn_stop_strategies",
                return_value=[],
            ),
        ):
            return build_user_aggregator_params(
                welcome_enabled=False,
                vad_stop_secs=vad_stop_secs,
            )

    def test_existing_callers_keep_default_vad_finalization_delay(self) -> None:
        params = self._build(use_silero=False)

        self.assertEqual(params.vad_analyzer.params.stop_secs, 0.2)

    def test_pipeline_can_request_longer_vad_finalization_delay(self) -> None:
        params = self._build(use_silero=False, vad_stop_secs=0.5)

        self.assertEqual(params.vad_analyzer.params.stop_secs, 0.5)

    def test_explicit_pipeline_delay_also_applies_to_silero_timeout_mode(self) -> None:
        params = self._build(use_silero=True, vad_stop_secs=0.5)

        self.assertEqual(params.vad_analyzer.params.stop_secs, 0.5)

    def test_silero_timeout_mode_keeps_its_environment_default_without_override(self) -> None:
        params = self._build(use_silero=True)

        self.assertEqual(params.vad_analyzer.params.stop_secs, 0.9)

    def test_negative_explicit_delay_is_clamped(self) -> None:
        params = self._build(use_silero=False, vad_stop_secs=-1.0)

        self.assertEqual(params.vad_analyzer.params.stop_secs, 0.0)
