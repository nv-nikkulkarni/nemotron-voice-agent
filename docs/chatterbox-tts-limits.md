# "Chatterbox TTS breaks" — root cause & fix

## Symptom
Intermittently, the bot's spoken reply **cuts off mid-sentence** or **goes silent**
when using **Chatterbox** TTS. It's intermittent — most replies are fine.

## Root cause
The **Chatterbox NIM has two hard 500 limits per synthesis request**, both set in its
Triton model config `/data/models/chatterbox-Chatterbox-Multilingual/config.pbtxt`
(no env override exists):

| Param | Default | Exceeded by | Effect |
|---|---|---|---|
| `max_input_length` | **500 characters** | one TTS chunk > 500 chars | **hard gRPC failure — no audio at all** (bot goes silent) |
| `max_speech_token_len` | **500 speech tokens (~20 s)** | one chunk ~290–500 chars (>20 s of speech) | **audio truncated at exactly ~20 s** (voice cuts off) |

Why it's intermittent: the app **streams TTS sentence-by-sentence**, so each chunk is
normally short. The limit only trips when a **single chunk** is long — a run-on
sentence, a long comma list (e.g. "count to 100", enumerations), or a verbose answer
whose sentence exceeds ~20 s / 500 chars. (A long *reply* made of short sentences is
fine — e.g. a 42 s story streamed in pieces synthesizes cleanly.)

## Evidence
- Chatterbox NIM log shows the truncation **16×** and the hard-fail **3×** (recurring
  on 07-30, 08-03, 08-04) — `chatterbox_model.py:865`.
- Source: `chatterbox_model.py:155` `max_input_length` (default 500),
  `:171` `max_new_tokens = max_speech_token_len` (default 500).

## Reproduction (deterministic — see `tests/voicetest/`)
- 50 short-answer turns (20 sequential + 30 @ concurrency 6) → **0 breaks** (short
  chunks never hit the cap) — `repro_chatterbox.py`, `repro_chatterbox_concurrent.py`.
- Direct Chatterbox call, 1960-char chunk → `Input text length (1960) exceeds maximum
  allowed length (500)` → **no audio**.
- Direct Chatterbox call, 391-char chunk (>20 s speech) → `output_audio = 20.0 s`
  (truncated) + the truncation counter incremented.

## Fixes (recommend both)
1. **App-side chunk splitting (robust, deployment-agnostic).** Ensure no single TTS
   chunk exceeds ~450 chars / ~18 s before it reaches Chatterbox — split long sentences
   on clause boundaries (commas/semicolons) or a hard char cap in the TTS text
   aggregator. This keeps Chatterbox within its limits regardless of NIM config and
   never regresses audio quality.
2. **Raise the NIM limits (headroom).** Bump `max_input_length` and
   `max_speech_token_len` in the Chatterbox model `config.pbtxt` (e.g. 500 → ~2000).
   Caveat: no env override, so it needs a model-config layer/override in the NIM
   deploy, and can't exceed what the Chatterbox model was trained to generate.
3. **Prompt mitigation (partial).** Keep replies concise with **short, well-punctuated
   sentences** so chunks stay small. Helps but doesn't guarantee sentence length.
