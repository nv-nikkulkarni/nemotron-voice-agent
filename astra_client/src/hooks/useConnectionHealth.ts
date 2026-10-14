// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

// Lightweight connection-health signal for the session HUD. While a session is
// live it periodically measures round-trip time to the same-origin /health
// endpoint (which nginx proxies to the NVCF gateway) and maps it to a 0–3 bar
// strength. Transport-agnostic — works for both WebSocket and WebRTC.

import { useEffect, useRef, useState } from "react";
import { useConnectionState } from "./useConnectionState";

export type SignalStrength = 0 | 1 | 2 | 3;

export interface ConnectionHealth {
  bars: SignalStrength;
  /** Last measured round-trip time in ms (0 until first sample). */
  rtt: number;
  connected: boolean;
  connecting: boolean;
  /** True once at least one sample has landed. */
  ready: boolean;
}

const PING_INTERVAL_MS = 3000;
const PING_TIMEOUT_MS = 4000;

function barsForRtt(rtt: number): SignalStrength {
  if (rtt <= 0) return 0;
  if (rtt < 150) return 3;
  if (rtt < 400) return 2;
  return 1;
}

async function pingOnce(signal: AbortSignal): Promise<number> {
  const start = performance.now();
  await fetch("/health", { method: "GET", cache: "no-store", signal });
  return performance.now() - start;
}

export function useConnectionHealth(): ConnectionHealth {
  const { isConnected, isConnecting } = useConnectionState();
  const [rtt, setRtt] = useState(0);
  const [ready, setReady] = useState(false);
  const emaRef = useRef(0);

  useEffect(() => {
    if (!isConnected) {
      setRtt(0);
      setReady(false);
      emaRef.current = 0;
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const sample = async () => {
      const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      try {
        const ms = await pingOnce(controller.signal);
        clearTimeout(timeout);
        if (cancelled) return;
        // Exponential moving average to smooth out jitter.
        emaRef.current = emaRef.current ? emaRef.current * 0.6 + ms * 0.4 : ms;
        setRtt(Math.round(emaRef.current));
        setReady(true);
      } catch {
        clearTimeout(timeout);
        if (cancelled) return;
        // A failed/aborted ping reads as a weak link, not a hard drop.
        emaRef.current = emaRef.current ? emaRef.current * 0.6 + 600 * 0.4 : 600;
        setRtt(Math.round(emaRef.current));
        setReady(true);
      }
    };

    void sample();
    const id = setInterval(sample, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [isConnected]);

  return {
    bars: isConnected ? barsForRtt(rtt) : 0,
    rtt,
    connected: isConnected,
    connecting: isConnecting,
    ready,
  };
}
