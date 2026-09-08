# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Correlate each measured turn with what the cluster was doing at that instant.

Reads results/analysis.json (per-turn epoch windows + defect flags) and the
saved pod logs in results/logs/*.log, then for every turn attaches the pipeline
events that fell inside its [t_start, t_end] window:

  * LLM   TTFB   (NvidiaLLMService ... TTFB: N s)      -> response-latency cause
  * LLM   processing time                              -> slow generation
  * TTS   "Generating TTS [..]" + text aggregation     -> TTS timing
  * WARN/ERROR/exception/WebSocketDisconnect           -> hangs / broken audio

The app (loguru) and NIM logs stamp UTC; turn epochs are UTC epoch, so we parse
app-log timestamps as UTC and match by absolute time. Prints a focused root-cause
readout for every turn the analysis flagged, plus per-pass TTFB stats.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS_DIR = HERE / "results"
LOG_DIR = RESULTS_DIR / "logs"

# loguru line: "2026-07-30 07:27:23.679 | LEVEL    | module:func:line - [stream_id=..] msg"
TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)")
STREAM_RE = re.compile(r"stream_id=([0-9a-f]+)")
TTFB_RE = re.compile(r"(Nvidia\w+Service#\d+) TTFB: ([\d.]+)s")
PROC_RE = re.compile(r"(Nvidia\w+Service#\d+) processing time: ([\d.]+)s")
GENTTS_RE = re.compile(r"Generating TTS \[(.*?)\]")


def _epoch(ts: str) -> float:
    return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=timezone.utc).timestamp()


def load_app_events(path: Path):
    events = []
    if not path.exists():
        return events
    for line in path.read_text(errors="ignore").splitlines():
        m = TS_RE.match(line)
        if not m:
            continue
        ep = _epoch(m.group(1))
        low = line.lower()
        rec = {"epoch": ep, "line": line}
        if (t := TTFB_RE.search(line)):
            rec["ttfb"] = (t.group(1), float(t.group(2)))
        if (p := PROC_RE.search(line)):
            rec["proc"] = (p.group(1), float(p.group(2)))
        if (g := GENTTS_RE.search(line)):
            rec["tts_text"] = g.group(1)
        # Normal end-of-turn teardown when the harness closes the session — NOT a
        # fault. Exclude so genuine errors stand out.
        benign = any(k in low for k in (
            "on_client_disconnected", "client disconnected", "cancelling pipeline worker",
            "wait_for_cancel", "cancelframe", "closing. waiting for",
            "reached the end of the pipeline", "worker:_cancel", "_pipeline_end"))
        real = any(k in low for k in (
            "error", "exception", "traceback", "unavailable", "refused",
            "inplace update", "websocketdisconnect", "runtimeerror", "failed",
            "grpc", "status.", "rpc "))
        if real and not benign:
            rec["issue"] = True
        events.append(rec)
    return events


def in_window(events, t0, t1, pad=1.0):
    return [e for e in events if t0 - pad <= e["epoch"] <= t1 + pad]


def main():
    analysis = json.loads((RESULTS_DIR / "analysis.json").read_text())
    app_events = load_app_events(LOG_DIR / "app.log")
    print(f"app log events parsed: {len(app_events)}")

    correlated = {"passes": {}}
    for pname, pdata in analysis["passes"].items():
        print(f"\n{'#'*78}\n# PASS {pname}\n{'#'*78}")
        ttfbs = {"llm": [], "tts": [], "asr": []}
        rows_out = []
        for r in pdata["rows"]:
            t0, t1 = r.get("t_start_epoch"), r.get("t_end_epoch")
            win = in_window(app_events, t0, t1) if (t0 and t1) else []
            llm_ttfb = [v for e in win if (v := e.get("ttfb")) and "LLM" in v[0]]
            tts_ttfb = [v for e in win if (v := e.get("ttfb")) and "TTS" in v[0]]
            asr_ttfb = [v for e in win if (v := e.get("ttfb")) and "STT" in v[0]]
            llm_proc = [v for e in win if (v := e.get("proc")) and "LLM" in v[0]]
            issues = [e["line"] for e in win if e.get("issue")]
            tts_texts = [e["tts_text"] for e in win if e.get("tts_text")]
            for _, v in llm_ttfb:
                ttfbs["llm"].append(v)
            for _, v in tts_ttfb:
                ttfbs["tts"].append(v)
            for _, v in asr_ttfb:
                ttfbs["asr"].append(v)

            rec = {
                "slug": r["slug"], "flags": r["flags"],
                "welcome_s": r["welcome_s"], "ttfa_s": r["ttfa_s"],
                "llm_ttfb": [round(v, 2) for _, v in llm_ttfb],
                "llm_proc_s": [round(v, 2) for _, v in llm_proc],
                "tts_ttfb": [round(v, 2) for _, v in tts_ttfb],
                "asr_ttfb": [round(v, 2) for _, v in asr_ttfb],
                "n_tts_sentences": len(tts_texts),
                "issues": issues[:6],
            }
            rows_out.append(rec)
            if r["flags"]:
                print(f"\n[{r['slug']}] {' '.join(r['flags'])}")
                print(f"   welcome={r['welcome_s']}s ttfa={r['ttfa_s']}s "
                      f"llm_ttfb={rec['llm_ttfb']} llm_proc={rec['llm_proc_s']} "
                      f"tts_ttfb={rec['tts_ttfb']} tts_sentences={rec['n_tts_sentences']}")
                for ln in issues[:4]:
                    print(f"     ! {ln[-150:]}")

        def _stats(xs):
            if not xs:
                return None
            xs = sorted(xs)
            import statistics
            return {"n": len(xs), "min": round(xs[0], 2), "med": round(statistics.median(xs), 2),
                    "max": round(xs[-1], 2)}
        print(f"\n--- {pname} stage TTFB (in-window) ---")
        for k in ("asr", "llm", "tts"):
            print(f"   {k}: {_stats(ttfbs[k])}")
        correlated["passes"][pname] = {"rows": rows_out,
                                       "ttfb_stats": {k: _stats(v) for k, v in ttfbs.items()}}

    (RESULTS_DIR / "correlation.json").write_text(json.dumps(correlated, indent=1))
    print(f"\nWrote {RESULTS_DIR/'correlation.json'}")


if __name__ == "__main__":
    main()
