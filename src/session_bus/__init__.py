# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause

"""Redis-backed session bus: shared media/config for multi-replica deployments.

IMPORTANT: this package re-exports only ``client``. Do NOT import ``.media`` or
``.session_config`` here — they import ``WebcamFrame``/``Attachment`` from the
store modules, and the store modules import ``session_bus.client`` at their own
module top, so importing ``.media`` eagerly here would create an import cycle
(store -> session_bus -> media -> store). ``.media``/``.session_config`` are
imported lazily, inside functions, by the store shims and by ``server.py``.
"""

from .client import TTL, aclose, async_client, init_from_env, is_enabled, sync_client  # noqa: F401
