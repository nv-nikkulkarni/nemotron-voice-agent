# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Checks that spoken text matches a session locked to one language."""

from __future__ import annotations

import re

# Scripts of session languages that are not written in Latin letters.
SCRIPT_RE = {
    "hi": re.compile(r"[ऀ-ॿ]"),
    "ja": re.compile(r"[぀-ヿ一-鿿]"),
    "ko": re.compile(r"[가-힯ᄀ-ᇿ]"),
    "zh": re.compile(r"[一-鿿]"),
}

# Latin words a reply in another language may legitimately keep: brands, tickers, and units.
_ALLOWED_LATIN = frozenset(
    {"nvidia", "nvda", "nemotron", "bmi", "ai", "gpu", "usd", "inr", "km", "kg", "cm", "c", "f", "am", "pm"}
    | {"ist", "utc", "gmt", "ok", "nasdaq", "nyse"}
)
_LATIN_WORD_RE = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")
# English function words; two or more in an ASCII-only reply mean it is English.
_ENGLISH_WORDS = frozenset(
    {"the", "is", "are", "it's", "here's", "with", "and", "your", "my", "you", "of", "at", "this", "that", "there"}
    | {"i", "i'm", "i'll", "can", "will", "for", "about", "right", "now", "currently", "trading"}
)


def base_language(code: str) -> str:
    """Return the lowercase base language of a BCP-47 code, such as "hi" for "hi-IN"."""
    return (code or "").split("-", 1)[0].casefold()


def is_english(code: str) -> bool:
    """Return whether ``code`` is empty or English, so no language check applies."""
    return base_language(code) in {"", "en"}


def text_in_language(text: str, code: str) -> bool:
    """Return whether ``text`` reads as the session language ``code``.

    Non-Latin languages need at least 60% of their letters in the language's script and at
    most two Latin words besides brands and units. Latin-script languages fail only for
    ASCII text with two or more English function words. English sessions always pass.
    """
    if is_english(code):
        return True
    words = [word.casefold().replace("’", "'") for word in _LATIN_WORD_RE.findall(text)]
    script = SCRIPT_RE.get(base_language(code))
    if script is not None:
        # Brands and units stay in Latin letters; count only the remaining text.
        remainder = _LATIN_WORD_RE.sub(
            lambda match: "" if match.group().casefold() in _ALLOWED_LATIN else match.group(), text
        )
        letters = [character for character in remainder if character.isalpha()]
        if not letters:
            return True
        native = sum(1 for character in letters if script.match(character))
        stray = [word for word in words if word not in _ALLOWED_LATIN]
        return native >= 0.6 * len(letters) and len(stray) <= 2
    if not any(character.isalpha() for character in text):
        return True
    if not text.isascii():
        return True
    return sum(1 for word in words if word in _ENGLISH_WORDS) < 2


# Fixed fillers for sessions locked to a language other than English, spoken when the
# Talker's own filler is rejected (for example because it wrote it in English). The
# Hindi phrase is gender-neutral because the TTS voice can be either gender.
SESSION_FALLBACK_FILLERS = {
    "de": "Einen Moment, ich sehe kurz nach.",
    "es": "Un momento, lo consulto ahora mismo.",
    "fr": "Un instant, je vérifie tout de suite.",
    "hi": "एक पल रुकिए, जानकारी देखी जा रही है।",
    "it": "Un attimo, controllo subito.",
    "ja": "少々お待ちください。確認しています。",
    "ko": "잠시만 기다려 주세요. 확인하고 있어요.",
    "pt": "Um momento, vou verificar agora.",
    "zh": "请稍等，我正在查询。",
}


def session_fallback_filler(code: str) -> str:
    """Return the fixed filler for a non-English session language, or "" for English."""
    return SESSION_FALLBACK_FILLERS.get(base_language(code), "")


def _compact(text: str) -> str:
    return "".join(character for character in text.casefold() if character.isalnum())


def repeats_progress_phrase(text: str, code: str, spoken_filler: str = "") -> bool:
    """Return whether a reply to a finished result repeats a progress phrase.

    True when ``text`` says nothing beyond the session language's fixed filler or the filler
    already spoken for this call, or when it starts by repeating the spoken filler. Spacing
    and punctuation are ignored. Only sessions locked to a non-English language are checked.
    """
    if is_english(code) or not text.strip():
        return False
    reply = _compact(text)
    phrases = [_compact(phrase) for phrase in (session_fallback_filler(code), spoken_filler) if phrase]
    for phrase in phrases:
        if not phrase:
            continue
        if not reply.replace(phrase, ""):
            return True
        if phrase == _compact(spoken_filler) and reply.startswith(phrase):
            return True
    return False
