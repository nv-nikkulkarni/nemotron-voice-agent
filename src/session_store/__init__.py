# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Shared object storage for session-capture artifacts (log, transcript, audio).

Only this package (and session_capture, which consumes it) knows about
backends. SESSION_STORE_BACKEND=local (default) needs no new infrastructure —
same "everything still works with nothing extra deployed" contract as
session_bus/REDIS_URL.
"""

from . import keys  # noqa: F401
from .backends import ObjectBackend  # noqa: F401
from .client import backend, init_from_env, is_s3  # noqa: F401

__all__ = ["keys", "ObjectBackend", "backend", "init_from_env", "is_s3"]
