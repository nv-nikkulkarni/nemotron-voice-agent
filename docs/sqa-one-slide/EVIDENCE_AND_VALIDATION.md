# SQA Architecture Evidence And Validation

## Purpose

This note records the sources, evidence boundaries, and file checks for the
Nemotron Voice Agent software quality assurance (SQA) architecture slide. The
slide is a compact system map. It is not evidence that a particular release or
deployment passed every gate.

## Canonical Outputs

The directory contains these presentation outputs:

| File | Role | Recovered validation |
| --- | --- | --- |
| `nemotron-voice-agent-sqa-system.svg` | Editable vector source | Valid XML; 1,920 x 1,080 view box |
| `nemotron-voice-agent-sqa-system.png` | Review preview | Valid 3,840 x 2,160 RGB PNG |
| `nemotron-voice-agent-sqa-system.pptx` | One-slide presentation | Valid Open XML ZIP; one slide; 17 archive members |

The PowerPoint slide embeds the PNG preview as one image. The embedded image is
byte-for-byte identical to the sibling PNG. Use the SVG when you need to edit
individual diagram elements.

## Architecture Evidence

The diagram records four connected qualification layers:

1. Test intent starts with unit and protocol contracts, model and service
   evaluations, browser qualification, and direct voice or cluster probes.
2. Real-user-path tests send generated speech through Playwright and Chromium,
   the shipped user interface, WebSocket transport, the voice pipeline, and an
   independent automatic speech recognition oracle.
3. Concurrency tests exercise multiple application replicas, Redis shared
   state, SeaweedFS capture staging, finalization, and NVIDIA GPU Cloud (NGC)
   upload proof.
4. Transport, speech, grounding, multimodal, concurrency, and durability
   oracles feed reports and the Viking, staging, and production promotion
   gates.

The rendered slide identifies its authored-source snapshot as
`dev/nikkulkarni/nvcf-deploy-rebased` at `4ab02ca7`, generated on August 24,
2026. The source inspection covered `tests/sqa/`, `tests/uitest/`,
`tests/voicetest/`, `tests/model_eval/`, `tests/pipecat_evals/`, session bus,
session store, session capture, cross-pod, and scaling tests that existed in
that snapshot.

The current recovered checkout does not contain every authored SQA source used
to generate the slide. The latest recovered GitHub branch snapshot used for
the voice-test regeneration is
`origin/dev/nikkulkarni/nvcf-deploy-rebased` at
`b31a935440c2fff267694eab35fdeb478e692511`. Keep the rendered snapshot label
until all three canonical presentation outputs are regenerated together from a
new source review.

## Recovered Voice-Test Evidence

On September 06, 2026, the missing voice artifacts were regenerated against
the active isolated Astra and NVIDIA Cloud Functions (NVCF) endpoint for
`nemotron-voice-agent-2`, chart `0.1.130`.

The recovery used the authored voice-test scripts from the recovered branch
snapshot in an isolated temporary directory. The replay used the intact 16 kHz
input fixtures. An independent generation check loaded the recovered Piper
`en_US-lessac-medium` model and synthesized all 40 source utterances, confirming
that the offline input-generation dependency works. Piper synthesis is not
byte-deterministic, so the check validated count, format, and content source
rather than file checksums. The deployed Chatterbox
`Chatterbox-Multilingual.en-US.Male` voice supplied the response audio at
22.05 kHz.

The current service can speak a short progress message before a delegated final
answer. The historical harness stopped at the first bot-speech completion. A
temporary runner-only compatibility patch made the harness continue past the
known progress strings and capture the final answer. The patch did not modify
the repository, application image, chart, user interface, or deployment.

The recovery runs produced this evidence:

| Run | Result |
| --- | --- |
| Chatterbox 20-turn reproduction | 20 of 20 turns completed; zero broken turns; 40 required WAV files produced |
| Generic Nano quality pass | 20 of 20 turns produced audio and passed the analyzer's content check; zero hangs and zero no-audio turns |
| Independent audio analysis | Whisper transcription and acoustic checks completed; 16 turns carried dropout flags and six carried stall flags |
| Tool-event oracle | Reported zero of 14 because the recovered client result did not contain explicit tool events; grounded answer audio alone does not prove or disprove tool invocation |
| Server-log correlation | Incomplete: NVCF runtime-log retrieval required a personal API key, so the regenerated report contains zero server events and no stage timing correlation |

The acoustic flags are diagnosis candidates, not automatic release failures.
Review the associated WAV files and transcripts before classifying synthesis,
streaming, or independent-ASR defects.

## Presentation Validation

The recovered assets passed these checks on September 06, 2026:

- `file` recognized the expected PNG, SVG, and Microsoft PowerPoint formats.
- The PNG is 3,840 x 2,160 pixels, RGB, and non-interlaced.
- The SVG parsed as XML and declares a 1,920 x 1,080 coordinate space.
- `unzip -t` reported no compressed-data errors in the PowerPoint file.
- Every PowerPoint XML and relationship part parsed successfully.
- The PowerPoint contains one slide and one media asset.
- The embedded media SHA-256 matches the sibling PNG SHA-256.

The recovered file checksums are:

| File | SHA-256 |
| --- | --- |
| `nemotron-voice-agent-sqa-system.svg` | `007b60647928c12eee0d1928a230132428359b3469c90564b0287f5bb86d2570` |
| `nemotron-voice-agent-sqa-system.png` | `df5e790dabd4578db685ce38708d859507491a2f22ac9d60e3fb19a132f0485f` |
| `nemotron-voice-agent-sqa-system.pptx` | `46d9e3ca4a154467337eefda45cb1fe7d8bdb821c1eee4b3cf3b9de2b9338d1c` |

## Evidence Boundaries

- Do not use this slide as a current release qualification report.
- Do not infer a Viking, Astra, NVCF, session-capture, or NGC pass from the
  presence of a path in the diagram.
- Historical reports remain historical until the same gate is rerun against
  the exact candidate artifacts.
- Raw audio and runtime logs are generated evidence and remain outside the
  committed source history.
- Recreate the server-log correlation after a personal NGC API key with NVCF
  log access is available.
