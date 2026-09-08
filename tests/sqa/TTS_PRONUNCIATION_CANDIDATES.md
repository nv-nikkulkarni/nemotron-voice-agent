# TTS pronunciation candidates

## Purpose and evidence boundary

This is the maintained candidate list from the production real-audio probe on 2026-08-25, plus explicitly labeled later SQA observations. Each controlled-probe term was spoken through Magpie and Chatterbox and independently transcribed with Parakeet ASR. An ASR mismatch is a useful detector, not proof by itself; entries marked **candidate** should be human-listened before being promoted to the production dictionary.

The runtime registry is
[`src/examples/shared/pronunciation_registry.yaml`](../../src/examples/shared/pronunciation_registry.yaml).
It stores ARPAbet for review and portability, but ARPAbet is never sent to TTS.
The application extracts grapheme-to-IPA mappings and aliases for Magpie.
Chatterbox receives no custom dictionary.

The rejected 0.1.114 Viking candidate injected `TTS_IPA_FILE_PATH` through Helm
and pointed it at the registry path inside the application image. The built but
unqualified 0.1.115 Viking candidate retains this boundary. It changes
application requests; it does not redeploy the text-to-speech NVIDIA Inference
Microservice (NIM). The broad registry is unqualified until exact-word Viking
probes and human listening confirm every promoted mapping. Legacy flat
grapheme-to-IPA JSON and YAML files remain supported.

## 0.1.114 direct exact-word probe

The Viking probe generated 33 isolated clips across 10 categories. Its manifest
records 30 Magpie clips with 210 runtime dictionary mappings on every request
and three Chatterbox clips with zero mappings. The source registry contains 196
base entries; normalized aliases account for the larger runtime mapping count.
This verifies the model-specific request boundary, not pronunciation quality.

Independent Parakeet ASR produced useful listen-first flags for terms including
Visakhapatnam, Sao, Amodei, Nemotron, NVCF, NGC, SeaweedFS, vLLM, NVDA,
ChatGPT, and the Chatterbox and Magpie model names. ASR substitutions such as a
brand name becoming a common word are detectors only. A human listener must
review the corresponding exact clips before a mapping is promoted, changed, or
removed.

Evidence:

- Manifest:
  `tests/sqa/artifacts/viking-0.1.114-direct-pronunciation/direct_pronunciation_manifest.json`
- Independent ASR:
  `tests/sqa/artifacts/viking-0.1.114-direct-pronunciation/direct_pronunciation_asr.json`
- Exact audio: the 33 WAV files beside those JSON records, grouped by the 10
  manifest categories

## Candidate registry

| Priority | Grapheme | Magpie observation | Chatterbox observation | ARPAbet candidate | IPA candidate | Status/action |
|---|---|---|---|---|---|---|
| P0 | Nemotron | Independent ASR heard “Metron” | Independent ASR heard “Ultron” | `N EH1 M AH0 T R AA2 N` | `ˈnɛmətrɑn` | Strong candidate; confirm preferred brand stress with the model team |
| P0 | Redis | Independent ASR heard “Reads” | Independent ASR heard an unrelated phrase | `R EH1 D IH0 S` | `ˈrɛdɪs` | Strong candidate |
| P0 | NVCF | Model reduced it to NVC | ASR heard `N B C F` | `EH1 N V IY1 S IY1 EH1 F` | `ɛn viː siː ɛf` | Candidate; also force letter-by-letter text normalization |
| P0 | NGC | Acronym was absent from ASR | ASR captured only `N G` | `EH1 N JH IY1 S IY1` | `ɛn dʒiː siː` | Candidate; validate final-letter clipping |
| P0 | vLLM | Model generated a repeated `V.L.L...M` sequence and ASR omitted it | Model said `V L M`; ASR heard `B L M` | `V IY1 EH1 L EH1 L EH1 M` | `viː ɛl ɛl ɛm` | Fix text generation/normalization first, then validate dictionary |
| P1 | Riva | Independent ASR heard “Viva” | The short term was omitted by ASR | `R IY1 V AH0` | `ˈriːvə` | Candidate |
| P1 | Chatterbox | Independent ASR heard only “Box” | Clear | `CH AE1 T ER0 B AA2 K S` | `ˈtʃætərˌbɑks` | Candidate for Magpie; check initial-syllable clipping |
| P1 | Magpie | Clear | Independent ASR heard only “Pi” | `M AE1 G P AY2` | `ˈmæɡˌpaɪ` | Candidate for Chatterbox; check initial-syllable clipping |
| P1 | Finnhub | Model changed the word to “Sinhub” | Displayed `FinHub`, but ASR was empty | `F IH1 N HH AH2 B` | `ˈfɪnˌhʌb` | Needs a clean exact-word rerun, then likely candidate |
| P1 | SeaweedFS | Model split/corrupted the acronym | Model said `Seaweed F F S` | `S IY1 W IY2 D EH1 F EH1 S` | `ˈsiːˌwiːd ɛf ɛs` | Needs corrected text normalization and a clean rerun |
| P2 | NVIDIA | Clear in Magpie | Very short Chatterbox answer was not independently transcribed | `EH0 N V IH1 D IY0 AH0` | `ɛnˈvɪdiə` | Existing pronunciation mostly clear; listen to Chatterbox clip before adding |
| P2 | Astra | Clear in Magpie | Model changed it to “Astro” | `AE1 S T R AH0` | `ˈæstrə` | Model-output issue in Chatterbox run; clean rerun required |
| P2 | Pipecat | Clear as “pipe cat” in both | Clear | `P AY1 P K AE2 T` | `ˈpaɪpˌkæt` | No dictionary entry currently required |
| P2 | Perplexity | Clear | Clear | `P ER0 P L EH1 K S AH0 T IY0` | `pərˈplɛksəti` | No dictionary entry currently required |
| P2 | WeatherAPI | Clear | Clear letter spelling | `W EH1 DH ER0 EY1 P IY1 AY1` | `ˈwɛðər eɪ piː aɪ` | Prefer text normalization to “Weather A P I” |
| P2 | Kubernetes | Clear | Clear | `K UW2 B ER0 N EH1 T IY0 Z` | `ˌkuːbərˈnɛtiːz` | No dictionary entry currently required |
| P2 | Helm | Clear | Clear | `HH EH1 L M` | `hɛlm` | No dictionary entry currently required |
| P2 | H100 | Clear as “H one hundred” in Magpie | Model dropped the H and one | `EY1 CH W AH1 N HH AH1 N D R AH0 D` | `eɪtʃ wʌn ˈhʌndrəd` | Prefer text normalization to “H one hundred”; rerun Chatterbox |
| P2 | ARPAbet | Model split it into unrelated `ARPA` and `BET` answers | Clear as “ARPA bet” | `AA1 R P AH0 B EH2 T` | `ˈɑrpəˌbɛt` | Clean Magpie rerun required; Chatterbox is acceptable |
| P2 | 24/7 | Clear after normalized phrase | Clear after normalized phrase | `T W EH1 N T IY0 F AO1 R S EH1 V AH0 N` | `ˌtwɛnti ˈfɔr ˈsɛvən` | Normalize source text to “twenty four seven”; do not rely on a slash dictionary key |
| P2 | Dakar | Viking 0.1.110 matrix: correct displayed Magpie text, but independent ASR heard “the car” on one turn and “Dakar” on the repeat | Not tested in this matrix | `D AH0 K AA1 R` | `dəˈkɑr` | Listen-first candidate from one inconsistent ASR observation; run the exact-word probe before any dictionary decision |

## Original Minimal IPA Candidate Set

The original probe proposed this minimal set before the versioned registry existed:

```json
{
  "Nemotron": "ˈnɛmətrɑn",
  "Redis": "ˈrɛdɪs",
  "NVCF": "ɛn viː siː ɛf",
  "NGC": "ɛn dʒiː siː",
  "Riva": "ˈriːvə",
  "Chatterbox": "ˈtʃætərˌbɑks",
  "Magpie": "ˈmæɡˌpaɪ"
}
```

This JSON is historical evidence, not the current runtime registry. `vLLM`, `SeaweedFS`, `Finnhub`, `H100`, and `24/7` still need text normalization or a clean controlled rerun before qualification can isolate the TTS layer.

## Non-TTS issues exposed by the probe

The exact-repeat probe also found model/context defects that a dictionary cannot fix:

- Astra was described as Google’s platform rather than the NVIDIA deployment.
- Pipecat was described as a Linux pipe-and-cat command sequence rather than the agent framework.
- NVCF was expanded incorrectly.
- Exact-repeat instructions persisted across later turns and produced repeated “Understood, I’ll repeat...” preambles.
- `vLLM` triggered acronym repetition.
- Several very short Chatterbox utterances were partly or completely missed by independent ASR, which may indicate leading/trailing audio clipping rather than phoneme selection.
- In the Viking 0.1.110 matrix, user audio for `Hyderabad` was transcribed as `Heidebarbarb`; the grounded not-found response then repeated that corrupted spelling. Treat this as input-ASR/model-context evidence, not a TTS dictionary candidate.

## Evidence

- Machine-readable results: `pronunciation/pronunciation_probe_report.json`
- Probe implementation and candidate mappings: `pronunciation/pronunciation_probe.mjs`
- Magpie clips: `pronunciation/magpie_pron_1_bot.wav` through `magpie_pron_20_bot.wav`
- Chatterbox clips: `pronunciation/chatterbox_pron_1_bot.wav` through `chatterbox_pron_20_bot.wav`
- NGC capture: Magpie session `7de567399b9b`, `UPLOAD_COMPLETE`, 6.56 MB
- NGC capture: Chatterbox session `9ebd4ae5ac8b`, `UPLOAD_COMPLETE`, 2.1 MB
