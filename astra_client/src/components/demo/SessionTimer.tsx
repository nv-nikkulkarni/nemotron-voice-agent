// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import { useEffect, useRef, useState } from "react";
import {
  formatSessionTime,
  normalizeSessionSeconds,
  remainingSessionSeconds,
  sessionTimerTone,
} from "../../demo/sessionTimer";

export function SessionTimer({
  durationSeconds,
  onTimeout,
}: Readonly<{
  durationSeconds: number;
  onTimeout: () => void;
}>) {
  const duration = normalizeSessionSeconds(durationSeconds);
  const [remaining, setRemaining] = useState(duration);
  const timeoutRequested = useRef(false);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    const deadline = Date.now() + duration * 1000;

    const tick = () => {
      const next = remainingSessionSeconds(deadline, Date.now());
      setRemaining(next);
      if (next === 0 && !timeoutRequested.current) {
        timeoutRequested.current = true;
        onTimeoutRef.current();
      }
    };

    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [duration]);

  const tone = sessionTimerTone(remaining);
  return (
    <time
      className={`demo-timer ${tone}`.trim()}
      dateTime={`PT${remaining}S`}
      aria-label={`${remaining} seconds remaining in this conversation`}
    >
      <span className="demo-timer-dot" aria-hidden />
      {formatSessionTime(remaining)}
    </time>
  );
}
