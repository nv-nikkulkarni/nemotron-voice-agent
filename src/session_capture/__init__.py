# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Session capture: per-session log + consent/transcript + audio -> tarball -> NGC.

Entirely gated by ``SESSION_CAPTURE_ENABLED`` (see ``settings.py``) and driven
by config, never a hardcoded NGC org/resource. ``register_routes`` is a no-op
when disabled, so the capture APIs don't exist at all.
"""

from .capture import install_log_sink  # noqa: F401
from .routes import register_routes  # noqa: F401

__all__ = ["install_log_sink", "register_routes"]
