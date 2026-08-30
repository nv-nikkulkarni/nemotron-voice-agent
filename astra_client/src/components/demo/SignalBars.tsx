// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// A small 3-bar connection-health indicator (adapted from ori's SignalBars),
// driven by useConnectionHealth. Shows RTT on hover.

import { useConnectionHealth, type SignalStrength } from "../../hooks/useConnectionHealth";

const BAR_COLORS: Record<SignalStrength, string> = {
  0: "#6b7280",
  1: "#ef4444",
  2: "#eab308",
  3: "#76b900",
};

const HEIGHTS = [5, 10, 15];
const INACTIVE_OPACITY = 0.2;

function label(bars: SignalStrength, rtt: number): string {
  const quality = bars >= 3 ? "Strong" : bars === 2 ? "Fair" : bars === 1 ? "Weak" : "Offline";
  return rtt > 0 ? `Connection: ${quality} · ${rtt} ms round-trip` : `Connection: ${quality}`;
}

export function SignalBars() {
  const { bars, rtt, connected, ready } = useConnectionHealth();
  if (!connected) return null;

  const color = BAR_COLORS[bars];
  const width = 4;
  const gap = 2;
  const svgW = HEIGHTS.length * width + (HEIGHTS.length - 1) * gap;
  const svgH = 16;

  return (
    <span className="signal-bars" title={label(bars, rtt)} aria-label={label(bars, rtt)}>
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} aria-hidden>
        {HEIGHTS.map((h, i) => (
          <rect
            key={h}
            x={i * (width + gap)}
            y={svgH - h}
            width={width}
            height={h}
            rx={1}
            fill={color}
            opacity={ready && i < bars ? 1 : INACTIVE_OPACITY}
          />
        ))}
      </svg>
      {ready && rtt > 0 && <span className="signal-bars__rtt">{rtt}ms</span>}
    </span>
  );
}
