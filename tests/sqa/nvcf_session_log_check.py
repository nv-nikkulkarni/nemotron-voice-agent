# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Check server evidence for fixed-language Frontend/Backend sessions in NVCF logs.

Reads the table that ``ngc cf fn deploy log <function>:<version> --duration 10M``
prints (save it to a file first), and for each session ID reports the language
lock, the application transcriptions, the Talker's ``call_backend`` arguments,
filler acceptance, backend tool calls, and every text sent to TTS. A session
fails when its TTS text or an accepted filler is not in the locked language.

    python3 tests/sqa/nvcf_session_log_check.py deploy.log 458a6adec133 ...
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

_ROW = re.compile(r"\|\s*(\S.*?)?\s*\|\s*(\S*)\s*\|\s?(.*?)\s*\|\s*$")
_TIMESTAMP = re.compile(r"\d{4}-\d\d-\d\d")
_SCRIPTS = {"hi": r"[ऀ-ॿ]", "ja": r"[぀-ヿ一-鿿]", "ko": r"[가-힯]", "zh": r"[一-鿿]"}
_BACKEND_TOOL_CALL = r"Calling function\s*\[(get_|web_search|calculate_bmi|generate_random_number|show_architecture)"
_ALLOWED_LATIN = re.compile(
    r"^(nvidia|nvda|nemotron|bmi|ai|gpu|usd|inr|km|kg|cm|c|f|am|pm|ist|utc|ok|nasdaq)$", re.IGNORECASE
)


def _records(path: Path) -> list[tuple[str, str]]:
    """Join the wrapped table rows into (timestamp, message) records, oldest first."""
    records: list[list[str]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = _ROW.match(line)
        if not match:
            continue
        timestamp, message = match.group(1) or "", match.group(3)
        if _TIMESTAMP.match(timestamp):
            records.append([timestamp, message])
        elif records:
            records[-1][1] += message
    return sorted((timestamp, message) for timestamp, message in records)


def _in_language(text: str, language: str) -> bool:
    """Return whether ``text`` reads as ``language``: its script, and at most two stray Latin words."""
    script = _SCRIPTS.get(language)
    letters = [character for character in text if character.isalpha()]
    if not letters:
        return True
    latin = [word for word in re.findall(r"[A-Za-z]+", text) if not _ALLOWED_LATIN.match(word)]
    if script is None:
        return True
    native = sum(1 for character in letters if re.match(script, character))
    return native >= len(letters) * 0.6 and len(latin) <= 2


def check_session(records: list[tuple[str, str]], session_id: str) -> dict:
    """Collect one session's language evidence and its failures."""
    lines = [(ts, re.sub(r"\s+", " ", message)) for ts, message in records if session_id in message.replace(" ", "")]
    report: dict = {
        "session": session_id,
        "lines": len(lines),
        "language": "",
        "transcripts": [],
        "backend_calls": [],
        "fillers": [],
        "tools": [],
        "tts": [],
        "failures": [],
    }
    for timestamp, message in lines:
        clock = timestamp[11:23]
        if match := re.search(r"Session language locked\s*to\s*(\S+?)\s*\(", message):
            report["language"] = match.group(1)
        elif match := re.search(r"Transcription:\s*\[(.*)\]", message):
            report["transcripts"].append({"t": clock, "text": match.group(1)})
        elif "Calling function [call_backend" in message or "Calling function[call_backend" in message:
            arguments = re.search(r"arguments\s*(\{.*\})", message)
            text = arguments.group(1)[:300] if arguments else message[-300:]
            report["backend_calls"].append({"t": clock, "arguments": text})
        elif "Talker-authored filler" in message or "talker_filler_candidate" in message:
            report["fillers"].append({"t": clock, "log": message[-160:]})
        elif re.search(_BACKEND_TOOL_CALL, message):
            report["tools"].append({"t": clock, "call": message[message.find("Calling") :][:300]})
        elif match := re.search(r"Generating TTS\s*\[(.*)\]", message):
            report["tts"].append({"t": clock, "text": match.group(1)})
    language = report["language"].split("-", 1)[0].casefold()
    if not report["language"]:
        report["failures"].append("no session language lock in the log window")
    elif language != "en":
        for entry in report["tts"]:
            entry["in_language"] = _in_language(entry["text"], language)
            if not entry["in_language"]:
                report["failures"].append(f"TTS text not in {report['language']}: {entry['text'][:80]}")
    report["pass"] = not report["failures"]
    return report


def main(argv: list[str]) -> int:
    """Check every session ID given after the log path; exit 1 when one fails."""
    if len(argv) < 3:
        print(__doc__)
        return 2
    records = _records(Path(argv[1]))
    reports = [check_session(records, session_id) for session_id in argv[2:]]
    print(json.dumps(reports, ensure_ascii=False, indent=2))
    return 0 if all(report["pass"] for report in reports) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
