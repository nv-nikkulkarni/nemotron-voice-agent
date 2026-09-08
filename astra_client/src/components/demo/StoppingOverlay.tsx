// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// The "buffering" overlay shown while a session gracefully tears down. Rendered
// only when teardown is slow (see useSessionLifecycle's adaptive reveal), so a
// fast/clean close never flashes it.

import { useSessionLifecycle } from "../../hooks/useSessionLifecycle";

export function StoppingOverlayHost() {
  const { overlayVisible } = useSessionLifecycle();
  if (!overlayVisible) return null;
  return (
    <div className="stopping-overlay" role="status" aria-live="polite">
      <div className="stopping-overlay__card">
        <span className="stopping-spinner" aria-hidden />
        <p className="stopping-overlay__label">Ending session…</p>
        <p className="stopping-overlay__sub">Closing the stream and wrapping up.</p>
      </div>
    </div>
  );
}
