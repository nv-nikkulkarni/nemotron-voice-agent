# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Redis-backed session config store.

Replaces the ``SESSION_STORE_DIR`` shared-filesystem path in ``server.py`` for
multi-replica deployments: NVCF's zone-locked RWO block volumes can't be
co-mounted across pods, but a Redis key can be read from any pod. Named
``session_config`` (not ``config_store``) to avoid clashing with the
pre-existing, unrelated ``src/config_store.py`` generic KV module.
"""

from __future__ import annotations

import json

from . import client


def _key(session_id: str) -> str:
    return f"sb:cfg:{session_id}"


def put(session_id: str, config: dict) -> None:
    """Store a session's sanitized config, keyed by session_id."""
    client.sync_client().set(_key(session_id), json.dumps(config), ex=client.TTL)


def get(session_id: str) -> dict:
    """Return a session's stored config, or {} if absent/expired."""
    raw = client.sync_client().get(_key(session_id))
    return json.loads(raw) if raw else {}
