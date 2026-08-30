# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Length-limited sentence aggregator for TTS engines with a per-synthesis cap.

Some TTS NIMs (notably **Chatterbox**) cap a single synthesis request at ~500 characters
AND ~500 speech tokens (~20s of audio); a longer chunk either fails outright (gRPC error,
no audio) or is truncated mid-sentence. Pipecat's default ``SimpleTextAggregator`` only
flushes on sentence boundaries, so a single long *run-on* sentence — a comma list, "count
to 100", a verbose answer — becomes one oversized request and the bot's voice breaks.

``LengthLimitedSentenceAggregator`` behaves exactly like ``SimpleTextAggregator`` but ALSO
flushes once the buffer reaches ``max_chars``, breaking at the nearest clause/word boundary
so the split sounds natural and no chunk ever exceeds the engine's limit. Long *replies*
made of normal sentences are unaffected (they already flush per sentence).

Scope it to the affected engine only via :func:`resolve_tts_chunk_chars` — other TTS
engines (Magpie, zero-shot, …) keep the default aggregator and stream unchanged.
"""
from collections.abc import AsyncIterator

from pipecat.utils.text.base_text_aggregator import Aggregation, AggregationType
from pipecat.utils.text.simple_text_aggregator import SimpleTextAggregator

# Chatterbox truncates at ~500 speech tokens (~20s). Chars are only a proxy for duration
# and *dense* content (numbers, lists spoken deliberately) packs more speech per char —
# measured on Chatterbox: ~240 dense chars -> ~14s, ~299 -> ~20s (the cap). 240 keeps even
# worst-case dense chunks comfortably under 20s (and well under the 500-char cap), while
# normal prose (less dense) stays shorter still. Tunable per deployment via the catalog.
DEFAULT_CHATTERBOX_CHUNK_CHARS = 240


class LengthLimitedSentenceAggregator(SimpleTextAggregator):
    """Sentence aggregator that also flushes at ``max_chars`` (clause/word boundary)."""

    def __init__(self, *, max_chars: int = DEFAULT_CHATTERBOX_CHUNK_CHARS, **kwargs):
        """Initialize the base aggregator with a bounded synthesis chunk size."""
        super().__init__(**kwargs)
        self._max_chars = max(40, int(max_chars))

    async def aggregate(self, text: str) -> AsyncIterator[Aggregation]:
        """Yield complete sentences or safe bounded chunks for long sentences."""
        if self._aggregation_type == AggregationType.TOKEN:
            async for agg in super().aggregate(text):
                yield agg
            return

        for char in text:
            self._text += char
            # 1) normal sentence-boundary detection (with lookahead), unchanged.
            result = await self._check_sentence_with_lookahead(char)
            if result:
                yield result
                continue
            # 2) length cap: if a sentence runs longer than the engine allows, flush the
            #    portion up to the nearest clause/word boundary so we never send an
            #    oversized synthesis request.
            if len(self._text) >= self._max_chars:
                cut = self._safe_break(self._text, self._max_chars)
                chunk = self._text[:cut].strip(" ")
                self._text = self._text[cut:].lstrip(" ")
                self._needs_lookahead = False
                if chunk:
                    yield Aggregation(text=chunk, type=AggregationType.SENTENCE)

    @staticmethod
    def _safe_break(s: str, limit: int) -> int:
        """Index to cut ``s`` at: the last clause boundary, else word boundary, else hard."""
        window = s[:limit]
        floor = limit // 2  # avoid emitting a tiny chunk
        for punct in (",", ";", ":", "—"):  # comma / semicolon / colon / em-dash
            idx = window.rfind(punct)
            if idx >= floor:
                return idx + 1
        idx = window.rfind(" ")
        if idx >= floor:
            return idx + 1
        return limit  # last resort: hard cut (still under the engine limit)


def resolve_tts_chunk_chars(
    model: str, voice: str, body: dict | None = None, default_entry: dict | None = None
) -> int:
    """Return the per-chunk char cap for the selected TTS engine, or 0 to disable.

    Precedence: explicit ``tts_max_chunk_chars`` in the session body, then the catalog
    entry's ``max_tts_chunk_chars``, else a built-in default for Chatterbox (detected by
    model/voice name). Any other engine returns 0 (no splitting — streams as-is).
    """
    body = body or {}
    default_entry = default_entry or {}
    explicit = body.get("tts_max_chunk_chars") or default_entry.get("max_tts_chunk_chars")
    if explicit:
        try:
            return max(0, int(explicit))
        except (TypeError, ValueError):
            return 0
    ident = f"{model} {voice}".lower()
    return DEFAULT_CHATTERBOX_CHUNK_CHARS if "chatterbox" in ident else 0
