# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Analyze the exhaustive-suite results: "listen" to every captured bot WAV and
score conversation quality.

For each measured turn (results/quality_results.json) this computes:

  INTELLIGIBILITY  — transcribe the bot's own TTS audio with an INDEPENDENT ASR
    (faster-whisper base.en) and compare to what the bot intended to say
    (bot_text). A low match ratio => garbled / broken / truncated speech that a
    listener would struggle with. This is the machine-"listening" pass.

  ACOUSTIC DEFECTS — from the WAV samples: duration, RMS (dBFS), peak, clipping
    fraction, leading/trailing silence, and the longest INTERNAL silence gap
    (an audible mid-utterance dropout).

  STREAMING DEFECTS — from the per-chunk arrival timing sidecar: the largest gap
    between consecutive bot audio chunks after speech started (a stall the user
    hears as a hitch), and whether audio was generated slower than real time.

  CORRECTNESS — did bot_text satisfy the query's lenient content regex; did the
    expected tool fire (generic).

Writes results/analysis.json and prints a per-file "listening" log + summary.
"""
from __future__ import annotations

import json
import re
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
RESULTS_DIR = HERE / "results"

SILENCE_DBFS = -45.0      # a 20 ms window quieter than this counts as silence
WIN_MS = 20
DROPOUT_S = 0.35          # internal silence longer than this = audible dropout
STREAM_STALL_S = 0.40     # gap between arriving chunks longer than this = a hitch


# --------------------------------------------------------------------------- #
# audio metrics
# --------------------------------------------------------------------------- #
def _read_wav(path):
    with wave.open(str(path), "rb") as w:
        rate = w.getframerate()
        n = w.getnframes()
        pcm = w.readframes(n)
    x = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    return x, rate


def _win_rms_dbfs(x, rate):
    win = max(1, int(rate * WIN_MS / 1000))
    nwin = len(x) // win
    if nwin == 0:
        return np.array([]), win
    trimmed = x[: nwin * win].reshape(nwin, win)
    rms = np.sqrt((trimmed ** 2).mean(axis=1) + 1e-12)
    dbfs = 20 * np.log10(rms + 1e-12)
    return dbfs, win


def acoustic_metrics(path):
    x, rate = _read_wav(path)
    if x.size == 0:
        return {"empty": True}
    dbfs, win = _win_rms_dbfs(x, rate)
    silent = dbfs < SILENCE_DBFS
    dur = len(x) / rate
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    clip_frac = float(np.mean(np.abs(x) >= 0.995))
    overall_rms_db = float(20 * np.log10(np.sqrt((x ** 2).mean() + 1e-12) + 1e-12))
    dc = float(x.mean())

    # leading / trailing / longest-internal silence (in seconds)
    def _run_edges(mask):
        lead = 0
        for v in mask:
            if v:
                lead += 1
            else:
                break
        trail = 0
        for v in mask[::-1]:
            if v:
                trail += 1
            else:
                break
        return lead, trail

    lead, trail = _run_edges(silent)
    # internal silence runs (exclude the leading/trailing edges)
    interior = silent[lead: len(silent) - trail] if len(silent) - trail > lead else np.array([])
    longest_internal = 0
    n_dropouts = 0
    cur = 0
    for v in interior:
        if v:
            cur += 1
            longest_internal = max(longest_internal, cur)
        else:
            if cur * WIN_MS / 1000 >= DROPOUT_S:
                n_dropouts += 1
            cur = 0
    if cur * WIN_MS / 1000 >= DROPOUT_S:
        n_dropouts += 1

    return {
        "empty": False,
        "rate": rate,
        "duration_s": round(dur, 2),
        "peak": round(peak, 3),
        "clip_frac": round(clip_frac, 4),
        "rms_dbfs": round(overall_rms_db, 1),
        "dc_offset": round(dc, 4),
        "lead_silence_s": round(lead * WIN_MS / 1000, 2),
        "trail_silence_s": round(trail * WIN_MS / 1000, 2),
        "longest_internal_silence_s": round(longest_internal * WIN_MS / 1000, 2),
        "n_dropouts": n_dropouts,
    }


def streaming_metrics(prefix):
    p = Path(f"{prefix}.timing.json")
    if not p.exists():
        return {}
    t = json.loads(p.read_text())
    offs = t.get("turn_chunk_offsets_s") or []
    if len(offs) < 2:
        return {"n_chunks": len(offs)}
    diffs = np.diff(np.array(offs))
    max_gap = float(diffs.max())
    n_stalls = int((diffs > STREAM_STALL_S).sum())
    span = offs[-1] - offs[0]
    return {
        "n_chunks": len(offs),
        "arrival_span_s": round(span, 2),
        "max_interchunk_gap_s": round(max_gap, 2),
        "n_stream_stalls": n_stalls,
    }


# --------------------------------------------------------------------------- #
# intelligibility (independent ASR)
# --------------------------------------------------------------------------- #
_WORD = re.compile(r"[a-z0-9]+")


def _norm(s):
    return _WORD.findall((s or "").lower())


def _ratio(a, b):
    """token-level similarity: 1.0 == identical word sequences (order-insensitive
    F1 over multisets), robust to TTS/ASR punctuation & casing differences."""
    from collections import Counter
    ca, cb = Counter(a), Counter(b)
    inter = sum((ca & cb).values())
    if not a and not b:
        return 1.0
    prec = inter / max(1, sum(cb.values()))
    rec = inter / max(1, sum(ca.values()))
    if prec + rec == 0:
        return 0.0
    return 2 * prec * rec / (prec + rec)


def load_asr():
    from faster_whisper import WhisperModel
    return WhisperModel("base.en", device="cpu", compute_type="int8")


def transcribe(model, path):
    segs, _ = model.transcribe(str(path), language="en", beam_size=1)
    return " ".join(s.text for s in segs).strip()


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def analyze():
    data = json.loads((RESULTS_DIR / "quality_results.json").read_text())
    asr = load_asr()
    out = {"passes": {}}

    for pname, pdata in data["passes"].items():
        print(f"\n{'='*78}\nPASS {pname}\n{'='*78}")
        rows = []
        for t in pdata["turns"]:
            slug = t["slug"]
            wav = t.get("turn_wav")
            heard = ""
            ac = {}
            sm = {}
            if wav and Path(wav).exists():
                ac = acoustic_metrics(wav)
                sm = streaming_metrics(str(RESULTS_DIR / pname / slug))
                heard = transcribe(asr, wav)
            intended = t.get("bot_text") or ""
            intel = round(_ratio(_norm(intended), _norm(heard)), 2) if (intended and heard) else (
                1.0 if (not intended and not heard) else 0.0)
            content_ok = bool(re.search(t["content"], intended, re.I)) if intended else False
            tool_ok = (t["expect_tool"] in (t.get("tools_called") or [])) if t.get("expect_tool") else None

            # defect flags
            flags = []
            if t.get("hang"):
                flags.append("HANG")
            if not wav:
                flags.append("NO_AUDIO")
            if ac and ac.get("n_dropouts"):
                flags.append(f"DROPOUT×{ac['n_dropouts']}")
            if ac and ac.get("longest_internal_silence_s", 0) >= DROPOUT_S:
                flags.append(f"gap{ac['longest_internal_silence_s']}s")
            if sm and sm.get("n_stream_stalls"):
                flags.append(f"STALL×{sm['n_stream_stalls']}(max{sm.get('max_interchunk_gap_s')}s)")
            if ac and ac.get("clip_frac", 0) > 0.02:
                flags.append(f"CLIP{ac['clip_frac']}")
            if intended and heard and intel < 0.6:
                flags.append(f"GARBLED({intel})")
            if intended and heard:
                # crude truncation check: heard much shorter than intended
                li, lh = len(_norm(intended)), len(_norm(heard))
                if lh < 0.6 * li and li >= 6:
                    flags.append(f"TRUNC({lh}/{li}w)")
            if not content_ok and intended:
                flags.append("CONTENT_MISS")

            welcome = t.get("time_to_greeting_audio_s")
            ttfa = t.get("time_to_first_bot_audio_s")
            row = {
                "slug": slug, "example": t["example"], "category": t["category"],
                "welcome_s": welcome, "ttfa_s": ttfa,
                "bot_audio_s": t.get("bot_audio_seconds"),
                "intel": intel, "content_ok": content_ok, "tool_ok": tool_ok,
                "tools_called": t.get("tools_called"),
                "hang": t.get("hang"), "finish_reason": t.get("finish_reason"),
                "intended": intended, "heard": heard,
                "acoustic": ac, "streaming": sm,
                "latency_breakdown": t.get("latency_breakdown"),
                "flags": flags,
                "t_start_epoch": t.get("t_start_epoch"), "t_end_epoch": t.get("t_end_epoch"),
            }
            rows.append(row)
            print(f"\n[{slug}] {t['category']}  welcome={welcome}s ttfa={ttfa}s "
                  f"audio={t.get('bot_audio_seconds')}s intel={intel} "
                  f"content_ok={content_ok} tool_ok={tool_ok} {' '.join(flags) or 'clean'}")
            print(f"   intended: {intended[:110]!r}")
            print(f"   heard   : {heard[:110]!r}")

        out["passes"][pname] = {"rows": rows, "summary": _summarize(rows)}

    (RESULTS_DIR / "analysis.json").write_text(json.dumps(out, indent=1))
    print(f"\n\nWrote {RESULTS_DIR/'analysis.json'}")
    _print_summaries(out)


def _pct(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return {
        "n": len(xs), "min": round(min(xs), 2), "med": round(float(np.median(xs)), 2),
        "p90": round(float(np.percentile(xs, 90)), 2), "max": round(max(xs), 2),
    }


def _summarize(rows):
    return {
        "n": len(rows),
        "hangs": sum(1 for r in rows if r["hang"]),
        "no_audio": sum(1 for r in rows if "NO_AUDIO" in r["flags"]),
        "content_ok": sum(1 for r in rows if r["content_ok"]),
        "tool_ok": sum(1 for r in rows if r["tool_ok"] is True),
        "tool_expected": sum(1 for r in rows if r["tool_ok"] is not None),
        "dropouts": sum(1 for r in rows if any(f.startswith("DROPOUT") for f in r["flags"])),
        "stalls": sum(1 for r in rows if any(f.startswith("STALL") for f in r["flags"])),
        "garbled": sum(1 for r in rows if any(f.startswith("GARBLED") for f in r["flags"])),
        "truncated": sum(1 for r in rows if any(f.startswith("TRUNC") for f in r["flags"])),
        "welcome_s": _pct([r["welcome_s"] for r in rows]),
        "ttfa_s": _pct([r["ttfa_s"] for r in rows]),
        "intel": _pct([r["intel"] for r in rows]),
    }


def _print_summaries(out):
    for pname, pdata in out["passes"].items():
        s = pdata["summary"]
        print(f"\n=== SUMMARY {pname} ===")
        print(f"  turns={s['n']} hangs={s['hangs']} no_audio={s['no_audio']} "
              f"content_ok={s['content_ok']}/{s['n']} "
              f"tool_ok={s['tool_ok']}/{s['tool_expected']}")
        print(f"  defects: dropouts={s['dropouts']} stalls={s['stalls']} "
              f"garbled={s['garbled']} truncated={s['truncated']}")
        print(f"  welcome_s: {s['welcome_s']}")
        print(f"  ttfa_s   : {s['ttfa_s']}")
        print(f"  intel    : {s['intel']}")


if __name__ == "__main__":
    analyze()
