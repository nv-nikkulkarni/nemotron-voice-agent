# Configure TTS

The pipeline synthesizes the spoken reply with a streaming **TTS** service. The default is NVIDIA **Magpie TTS Multilingual**, served from the cloud (NVIDIA-hosted NVCF endpoints) or self-hosted next to the pipeline as an [**NVIDIA NIM for Speech**](https://docs.nvidia.com/nim/speech/latest/tts/index.html) sidecar.

TTS services are declared per example in `services.cloud.yaml` (remote / NVCF) and `services.local.yaml` (Compose-managed sidecars). This page is the **model reference and configuration guide**: available models, how to size them, and how to set voices, pronunciation, and text filtering. For catalog mechanics (switching, adding, and overriding services), see [Configure Services](configure-services.md).

## Models

| Model | Catalog key | Self-hosted compose service | Modelcard |
|-------|-------------|-----------------------------|-----------|
| **Magpie TTS Multilingual**: default, streaming multilingual TTS with per-language voices | `magpie-multilingual-tts` | [`docker-compose.magpie-tts.yaml`](../../docker/docker-compose.magpie-tts.yaml) | [model card](https://build.nvidia.com/nvidia/magpie-tts-multilingual/modelcard) |
| **Magpie TTS Zeroshot**: multilingual streaming TTS that supports zero-shot voice cloning and includes built-in female and male voices | `magpie-zeroshot-tts` | [`docker-compose.magpie-zeroshot-tts.yaml`](../../docker/docker-compose.magpie-zeroshot-tts.yaml) | [model card](https://build.nvidia.com/nvidia/magpie-tts-zeroshot/modelcard) |
| **Chatterbox TTS Multilingual**: alternate streaming multilingual TTS | `chatterbox-multilingual-tts` | [`docker-compose.chatterbox-tts.yaml`](../../docker/docker-compose.chatterbox-tts.yaml) | [model card](https://build.nvidia.com/resembleai/chatterbox-multilingual-tts/modelcard) |

> Magpie Multilingual is the registry default and the TTS sidecar started by local recipes. Chatterbox and Magpie Zeroshot are opt-in: select their catalog key in the Services tab (or `defaults.tts` in [`examples_registry.yaml`](../../examples_registry.yaml)). For local NIM, also enable the matching Compose profile (see [Hardware requirements](#hardware-requirements-and-deployment-configs)).

Voice IDs follow each model's naming. For example, use `Magpie-Multilingual.EN-US.Aria`, `Magpie-ZeroShot-Multilingual.Female`, or `Chatterbox-Multilingual.en-US.Male`. The available voices and emotions depend on the deployed NIM. Refer to [available voices and emotions](https://docs.nvidia.com/nim/speech/latest/tts/voices.html).

### Supported Languages

The client discovers the active TTS service's available voices and language codes at runtime. Treat this table as model-level guidance, because exact availability can vary by endpoint, deployment profile, and selected NIM image.

For the multilingual assistant, this is **TTS-only** coverage, not the final session-language list. Voice Settings shows only the intersection of the selected ASR, TTS, and built-in LLM capabilities. For example, a Chatterbox deployment can advertise Arabic or Greek voices, but those locales are not available with the built-in Nemotron 3.5 Lightning or Nemotron 3 Super LLMs. See [Configure LLM](configure-llm.md#multilingual-session-languages).

| Model | Supported languages |
| --- | --- |
| [Magpie TTS Multilingual](https://docs.nvidia.com/nim/speech/latest/reference/support-matrix/tts.html#magpie-tts-multilingual) | English (`en-US`) · Spanish (`es-US`) · French (`fr-FR`) · German (`de-DE`) · Italian (`it-IT`) · Vietnamese (`vi-VN`) · Mandarin (`zh-CN`) · Hindi (`hi-IN`) · Japanese (`ja-JP`) · Modern Standard Arabic (`ar-XA`) · Korean (`ko-KR`) · Brazilian Portuguese (`pt-BR`) |
| [Magpie TTS Zeroshot](https://build.nvidia.com/nvidia/magpie-tts-zeroshot/modelcard) | English (`en-US`) · Spanish (`es-US`) · French (`fr-FR`) · German (`de-DE`) · Mandarin (`zh-CN`) · Vietnamese (`vi-VN`) · Italian (`it-IT`) · Hindi (`hi-IN`) · Japanese (`ja-JP`) · Modern Standard Arabic (`ar-XA`) · Brazilian Portuguese (`pt-BR`) · Korean (`ko-KR`) |
| [Chatterbox TTS Multilingual](https://docs.nvidia.com/nim/speech/latest/reference/support-matrix/tts.html#chatterbox-tts-multilingual) | Arabic (`ar-SA`) · Danish (`da-DK`) · German (`de-DE`) · Greek (`el-GR`) · English (`en-US`) · Spanish (`es-ES`) · Finnish (`fi-FI`) · French (`fr-FR`) · Hebrew (`he-IL`) · Hindi (`hi-IN`) · Italian (`it-IT`) · Japanese (`ja-JP`) · Korean (`ko-KR`) · Malay (`ms-MY`) · Dutch (`nl-NL`) · Norwegian (`nb-NO`) · Polish (`pl-PL`) · Brazilian Portuguese (`pt-BR`) · Russian (`ru-RU`) · Swedish (`sv-SE`) · Swahili (`sw-KE`) · Turkish (`tr-TR`) · Mandarin (`zh-CN`) |

For NVIDIA's current model and deployment support details, see the [TTS support matrix](https://docs.nvidia.com/nim/speech/latest/reference/support-matrix/tts.html).

> The active default per slot is set in [`examples_registry.yaml`](../../examples_registry.yaml) (`defaults`).
>
> **Streaming only.** The real-time pipeline needs a **streaming** TTS model. The streaming-capable TTS NIMs are **Magpie TTS Multilingual**, **Magpie TTS Zeroshot**, and **Chatterbox TTS Multilingual**. Check the [Pipecat NVIDIA TTS service](https://github.com/pipecat-ai/pipecat/blob/main/src/pipecat/services/nvidia/tts.py) for supported request fields and model-specific options.

## Hardware Requirements and Deployment Configs

TTS runs one of these ways, and the repo wires the right one per profile:

- **Cloud (NVCF)**: no local GPU. Magpie Multilingual and Chatterbox appear in the Services tab (no Compose change). Magpie Zeroshot has no cloud function.
- **Magpie TTS Multilingual (default server recipe)**: started by `*/server` recipes as `magpie-multilingual-tts-service` ([`docker-compose.magpie-tts.yaml`](../../docker/docker-compose.magpie-tts.yaml)). Universal `*/single-gpu` recipes use NeMo-Speech.cpp.
- **Opt-in local TTS (Chatterbox or Magpie Zeroshot)**: both are listed in Compose but do **not** start with the default recipe. They share Magpie Multilingual's host ports (`50151` / `9000`), so only one of Magpie Multilingual, Chatterbox, or Zeroshot can run at a time. Enable the opt-in profile and scale Magpie off:

  | Alternate | Compose profile | Catalog key | Compose file |
  |-----------|-----------------|-------------|--------------|
  | Chatterbox | `chatterbox-tts` | `chatterbox-multilingual-tts` | [`docker-compose.chatterbox-tts.yaml`](../../docker/docker-compose.chatterbox-tts.yaml) |
  | Magpie Zeroshot | `magpie-zeroshot-tts` | `magpie-zeroshot-tts` | [`docker-compose.magpie-zeroshot-tts.yaml`](../../docker/docker-compose.magpie-zeroshot-tts.yaml) |

  ```bash
  # Example: Magpie Zeroshot on the server recipe (same pattern for Chatterbox)
  docker compose --profile generic-assistant/server --profile magpie-zeroshot-tts \
    up -d --scale magpie-multilingual-tts-service=0
  ```

  Then select the matching catalog key in the Services tab (or `defaults.tts`). Omitting the opt-in profile leaves that sidecar running and holding the ports—stop it before Magpie Multilingual can bind again (`docker compose --profile <profile> stop <service>`, then recipe `up -d`).

  Magpie Zeroshot NGC access is restricted — apply at the [Magpie TTS Zeroshot NGC page](https://catalog.ngc.nvidia.com/orgs/nim/teams/nvidia/containers/magpie-tts-zeroshot). For audio-prompt cloning, see [Voice cloning / zero-shot](#voice-cloning--zero-shot).
- **NeMo-Speech.cpp (single GPU, including Jetson Thor)**: on `*/single-gpu`, an on-device sidecar serves Magpie TTS from local GGUF weights: `nemo-speech` / `nemo-speech-multilingual` (ASR + TTS together) or `nemo-speech-tts` (TTS only, for Omni). `scripts/download-nemo-speech-models.sh` also fetches Sparrowhawk TN grammars so digits and dates are spoken as words (`--tts.tn-model-dir=/models/tn_configs`). See [Jetson Thor](../03-jetson-thor.md).

### Optional Helm Zero-Shot Service

The [NVCF Helm chart](../../nvcf_helm/values.yaml) can add a dedicated Magpie
Zeroshot pod alongside the existing TTS services. Set `zeroShotTts.enabled: true`
in your deployment overrides after verifying a spare GPU and authorized NGC
container and model access. The default is `false`.

The chart uses `zeroShotImage.repository: nvcr.io/nim/nvidia/magpie-tts-zeroshot`
and `zeroShotImage.tag: "1.2.0"`. Set `zeroShotImage.digest` to pin the image;
a nonempty digest takes precedence over the tag. The default selector is
`zeroShotTts.nimTagsSelector: "batch_size=8"`, with a limit of 1 GPU.

The service is `magpie-zeroshot-tts-service:50051` for gRPC and port `9000`
for HTTP health. Enabling it adds `magpie-zeroshot-tts` to the chart-generated
TTS choices for Generic Frontend/Backend Agent and Omni Subagents. Select this
engine before enabling your browser reference sample.

The default `zeroShotTts.cache.nvcf: true` uses a 50 GiB `emptyDir` cache.
Set it to `false` to request a persistent volume claim; configure
`zeroShotTts.cache.storageClass` for your cluster instead of assuming the
`oci-bv` default is available. Pulling the image alone does not prove model
access or readiness. Check `/v1/health/ready` on port `9000` and a real preview
before qualifying voice cloning.

Refer to the [zero-shot deployment template](../../nvcf_helm/templates/deployment-magpie-zeroshot-tts.yaml)
for credential injection, startup probes, and cache mounts.

### VRAM & Hardware Support

| Model | Typical VRAM | Notes |
|-------|--------------|-------|
| Magpie TTS Multilingual | **12.58 GiB** GPU / 5.182 GiB host memory at `batch_size=8` | Can share a single ~80 GB GPU with ASR (~15 GB) and the LLM (~30 GB FP8). Split across GPUs with `device_ids` in [`docker-compose.magpie-tts.yaml`](../../docker/docker-compose.magpie-tts.yaml). See [Configure LLM → VRAM & hardware support](configure-llm.md#vram--hardware-support). |
| Magpie TTS Zeroshot | **13.06 GB** GPU / 4.00 GB CPU memory at `batch_size=8` | The default Compose selector is `name=magpie-tts-zeroshot,batch_size=8`. This profile fits the shared H100 layout when Magpie Multilingual is scaled off. |
| Chatterbox TTS | **44.61 GiB** GPU / 4.86 GiB host memory at `batch_size=8` | The default Compose selector is `name=chatterbox-tts-multilingual,batch_size=8` on GPU `0`. This profile supports A100 80 GB, H100, L40S, and DGX Spark. The A100 40 GB variant does not have enough memory. Chatterbox does **not** fit the Magpie single-80-GB shared layout with LLM + ASR. |

### Performance & Scaling

`batch_size` is the main TTS throughput knob (`NIM_TAGS_SELECTOR`):

#### Magpie TTS Multilingual 1.10.0

| `batch_size` | GPU memory | Host memory |
| --- | --- | --- |
| `8` (default) | 12.58 GiB | 5.182 GiB |
| `32` | 41.46 GiB | 5.208 GiB |
| `64` | 74.74 GiB | 5.258 GiB |

The standard Compose service selects `batch_size=8`. The `generic-assistant/server-perf` profile selects `batch_size=64` on a dedicated GPU.

#### Magpie TTS Zeroshot 1.2.0

| `batch_size` | GPU memory | CPU memory |
| --- | --- | --- |
| `8` (default) | 13.06 GB | 4.00 GB |
| `32` | 41.30 GB | 7.08 GB |

The Compose service selects `batch_size=8`. Use `batch_size=32` only on a dedicated GPU because it does not fit the shared H100 layout.

#### Chatterbox TTS Multilingual 1.1.0

| `batch_size` | GPU memory | Host memory |
| --- | --- | --- |
| `8` (default) | 44.61 GiB | 4.86 GiB |
| `32` | 46.84 GiB | 5.40 GiB |
| `64` | 49.72 GiB | 5.54 GiB |

The Compose service selects `batch_size=8`. A100 80 GB, H100, and L40S support all three profiles. The A100 40 GB variant does not have enough memory for any profile. DGX Spark supports only `batch_size=8`.

For first-chunk and inter-chunk latency and throughput (RTFX) across GPUs, refer to the **[TTS performance benchmarks](https://docs.nvidia.com/nim/speech/latest/reference/performances/tts/performance.html)**. For end-to-end pipeline latency (TTS time-to-first-byte) in this blueprint, refer to [Evaluation and Performance](../04-evaluation-and-performance.md).

## Customization

### Voices & Emotions

The active voice is the `voice_id` in the catalog entry. The upstream client includes a voice selector that discovers available voices and languages for mid-session switching. The Astra demo uses pre-session voice cards on the **Voice** studio page. Voice IDs follow each model's naming. For example, use `Magpie-Multilingual.EN-US.Aria`, `Magpie-ZeroShot-Multilingual.Female`, or `Chatterbox-Multilingual.en-US.Male`. Available voices and emotions depend on the deployed NIM and can be discovered at runtime over gRPC or HTTP. Refer to [available voices and emotions](https://docs.nvidia.com/nim/speech/latest/tts/voices.html).

- **Magpie Multilingual**: multiple voices and emotional styles per locale.
- **Magpie Zeroshot**: languages listed in [Supported languages](#supported-languages); built-in voices across locales are `Magpie-ZeroShot-Multilingual.Female` (default) and `Magpie-ZeroShot-Multilingual.Male` ([model card](https://build.nvidia.com/nvidia/magpie-tts-zeroshot/modelcard)).
- **Chatterbox**: **one default speaker per locale**.

To change the **default**, edit `voice_id` in the example's `services.cloud.yaml` / `services.local.yaml`. For a local Magpie NIM, point the entry at the sidecar (`magpie-multilingual-tts-service:50051` or `magpie-zeroshot-tts-service:50051`) under the active recipe section. See [Configure Services](configure-services.md).

```yaml
tts:
  magpie-multilingual-tts:
    name: "Magpie TTS Multilingual"
    server: "grpc.nvcf.nvidia.com:443"   # cloud. Local entries use the sidecar host:port (e.g. magpie-multilingual-tts-service:50051)
    voice_id: "Magpie-Multilingual.EN-US.Aria"
    model: "magpie-tts-multilingual"
    function_id: "877104f7-e885-42b9-8de8-f6e4c6303969"
    synthesis_mode: stitched

  chatterbox-multilingual-tts:
    name: "Chatterbox TTS Multilingual"
    server: "grpc.nvcf.nvidia.com:443"
    voice_id: "Chatterbox-Multilingual.en-US.Male"
    model: "chatterbox-tts-multilingual"
    function_id: "ddacc747-1269-4fab-bfd9-8f593dead106"
    synthesis_mode: per_sentence

  # Local only. No cloud function_id.
  magpie-zeroshot-tts:
    name: "Magpie TTS Zeroshot"
    server: "magpie-zeroshot-tts-service:50051"
    voice_id: "Magpie-ZeroShot-Multilingual.Female"
    model: "magpie-tts-zeroshot"
    function_id: ""
    synthesis_mode: stitched
    language_code: en-US
    # optional voice cloning:
    # zero_shot_audio_prompt_file: "/path/to/prompt.wav"
```

The catalog hydrates the required `model` and `function_id` fields and the optional `zero_shot_audio_prompt_file` field into the session, then passes them to Pipecat's `NvidiaTTSService`.

### Synthesis Mode

Pipecat's `NvidiaTTSService` supports two synthesis modes through the catalog field `synthesis_mode`:

| Value | Behavior |
|-------|----------|
| `stitched` | Reuse one Magpie `SynthesizeOnline` stream across sentences in a reply (smoother multi-sentence audio). Requires Pipecat `>=1.5.0`, plus Magpie TTS Multilingual `>=1.7.0` or Magpie TTS Zeroshot `>=1.2.0`. |
| `per_sentence` | Open a fresh synthesis call per sentence. Safe for models without cross-sentence stitching. |

Set `synthesis_mode` on the catalog entry (hydrated as `tts_synthesis_mode`). Magpie multilingual and Magpie zeroshot catalogs ship with `stitched`; Chatterbox ships with `per_sentence`. Always set the field explicitly so a UI/backend TTS switch cannot inherit another model's mode through the registry-default fallback in the pipeline.

The Frontend/Backend Agent and Omni Subagents use
[`DemoNvidiaTTSService`](../../src/examples/shared/demo_speech.py), which selects
`per_sentence` for Magpie. Ordinary sentences use `SynthesizeOnline`. Sentences
containing “Nemotron” use a bounded unary request to obtain word timestamps for
the targeted timing adjustment described below. Other examples retain their
catalog synthesis mode.

### Word-Level Input Streaming and Timestamps

> **NIM only.** `NvidiaWordTTSService` supports Magpie served by NVIDIA NIM. It does not support the GGML/GGUF-based NeMo-Speech.cpp backend used by `*/single-gpu` profiles.

Examples use Pipecat's `NvidiaTTSService` or the demo subclass described above, keeping Magpie Multilingual, Magpie Zeroshot, and Chatterbox switchable through the service catalog. For Magpie TTS Multilingual NIM 1.10.0 or newer, [`NvidiaWordTTSService`](../../src/examples/shared/nvidia_word_tts.py) is an optional drop-in subclass that adds word-level input streaming and timestamp-based LLM context commits. It requires `nvidia-riva-client>=2.27.0,<3`.

To opt in for a custom example, change only the service import and constructor:

```python
# Default
from pipecat.services.nvidia.tts import NvidiaTTSService

tts = NvidiaTTSService(**tts_kwargs)

# Opt in to Magpie 1.10.0+ word streaming and timestamp commits
from examples.shared.nvidia_word_tts import NvidiaWordTTSService

tts = NvidiaWordTTSService(**tts_kwargs)
```

`NvidiaWordTTSService` internally selects token aggregation, disables parent text-frame commits, uses stitched synthesis, and requests word timestamps. Do not set `text_aggregation_mode` or `push_text_frames` in the example. It also sets Magpie's `max_chunk_threshold` to 100 characters so a long input can be flushed before end of stream.

The UI renders assistant bubbles from LLM response events, independently of the selected TTS service. Word timestamps control when spoken text is committed to LLM context; they do not drive the displayed assistant response.

#### Known Magpie Limitations

- **Word timestamps are delayed until a flush.** Magpie returns timing metadata only after the end of the stream or the configured 100-character threshold. Before that flush, interruption handling cannot calculate the words already played or support progressive highlighting.
- **`meta.words` does not preserve spacing.** `response.meta.words` removes leading and trailing spaces and omits space-only tokens. Because a token may also be a subword or punctuation, clients cannot reliably reconstruct the original spoken text: inserting spaces can produce false gaps such as `"I'm Nem otron ,"`, while concatenating tokens can produce text such as `"IamNemotron,createdbyNVIDIA."`. `NvidiaWordTTSService` currently inserts spaces between timed tokens for readable context, so these false gaps are an expected limitation.

### Pronunciation (IPA)

Override Magpie's default pronunciation for specific words with an International Phonetic Alphabet (IPA) dictionary. Create a JSON or YAML dictionary file, then set `TTS_IPA_FILE_PATH` in `.env` to that path. Relative paths resolve from the repository root:

```bash
TTS_IPA_FILE_PATH=config/ipa.json
```

Example dictionary:

```json
{
  "NVIDIA": "ˈɛnˌvɪdiə",
  "GreenForce": "ɡriːn fɔrs",
  "API": "eɪ piː aɪ"
}
```

The loader also accepts the versioned registry in
[`pronunciation_registry.yaml`](../../src/examples/shared/pronunciation_registry.yaml).
Each `entries` item requires `ipa` and can retain `arpabet`, `category`, and
`aliases` metadata. ARPAbet is review metadata only. The runtime extracts
grapheme-to-IPA mappings and aliases for Magpie requests.

The NVCF Helm chart sets `TTS_IPA_FILE_PATH` from
`app.ttsPronunciationPath`, which defaults to the packaged registry. Magpie
receives the extracted IPA dictionary. Chatterbox receives no custom dictionary
because its request interface does not support this field. Legacy flat
grapheme-to-IPA JSON and YAML files remain compatible.

Restart the application after changing the file. You do not need to redeploy the
text-to-speech NVIDIA Inference Microservice (NIM). The broad packaged mappings
remain subject to human listening and exact-word Viking qualification before
promotion. Refer to the [SQA pronunciation evidence and registry boundary](../../tests/sqa/TTS_PRONUNCIATION_CANDIDATES.md).

The packaged “Nemotron” mapping is `ˈnimoʊˌtɹɑn`, a candidate derived from the
approved audio sample. Approval of the audio does not establish approval of
this IPA transcription. The demo subclass uses fresh Magpie NIM word timestamps
to apply `atempo=1.28` only to the target word. If “three” follows, it trims only
leading quiet audio toward a 25 ms gap, preserving the surrounding speech and
“three” onset. Missing or invalid alignment leaves the audio unchanged. Verify
these adjustments through listening before qualifying a deployment. The
[reference provenance](../../src/examples/shared/assets/nemotron-approved-reference.json)
records variant `8A-6`, source hashes, and timing parameters. The reference WAV
is not packaged in the repository; its timestamps are not reused for live audio.

For the dictionary format and the phonemes Magpie supports, refer to
[TTS customization](https://docs.nvidia.com/nim/speech/latest/tts/customization.html)
and [phoneme support](https://docs.nvidia.com/nim/speech/latest/tts/phoneme-support.html).

> **Check the wiring.** `TTS_IPA_FILE_PATH` only takes effect if the pipeline
> passes the selected model to `load_ipa_dictionary(tts_model)` and supplies its
> result as `custom_dictionary`. Passing the model prevents unsupported
> services such as Chatterbox from receiving the dictionary. Refer to the
> `NvidiaTTSService(...)` call in
> [`src/examples/generic/pipeline.py`](../../src/examples/generic/pipeline.py).

### Session Pronunciation Fixes in the Astra Client

Select **Voice** before starting a conversation and use **Pronunciation fixes**
in the studio. The list includes deployed defaults and your saved fixes. Select
**Edit** beside a rule, or enter a **Word** and **IPA pronunciation**, then
select **Save pronunciation**. Use **Find a pronunciation** to search the list.

You can save up to 50 custom rules per assistant. Each word accepts at most
80 characters, and each IPA value accepts at most 200 characters. Enter a single
word; create separate rules for multiword names. The editor accepts IPA without
markup and rejects ARPAbet numbers. Removing a custom rule restores the deployed
default for that word.

The browser saves rules per assistant in localStorage. They apply to
**Preview voice** and the next session through `tts_pronunciations`, a
word-to-IPA map. The backend combines validated session rules with its deployed
dictionary. This does not modify `TTS_IPA_FILE_PATH` or the packaged registry.
Reloading the page preserves your edits for the same browser profile and
origin. End the conversation before editing them.

IPA controls require a Magpie engine. Chatterbox does not receive these rules;
your edits remain saved when you switch back to Magpie. Preview a sentence with
the changed word and listen before using it in a demo. An IPA edit does not
establish human listening approval.

### TTS Text Filter

LLM output frequently contains Markdown emphasis and characters the Magpie preprocessor reserves for its own markup. Unfiltered, these are spoken literally, make synthesis fail, or produce odd audio. A text filter sits between the LLM and TTS and strips them before synthesis. The default filter removes:

- **`*`**: Markdown emphasis markers (for example `**bold**` and `*italic*`).
- **`{` and `}`**: ARPAbet phoneme tokens such as `{@AW1}`.
- **`<tag>`**: SSML tags parsed by the TTS engine.

These appear naturally in code, JSON, Markdown, or HTML output. The filter classes live in [`src/examples/shared/nemotron_speech_text_filter.py`](../../src/examples/shared/nemotron_speech_text_filter.py):

#### `NemotronSpeechTextFilter` (default)

This filter keeps visible link text while removing link destinations and HTML
tags. It removes Markdown heading, list, numbered-list, and blockquote prefixes,
backticks, double-underscore markers, asterisks, ARPAbet braces, and tag-opening
`<`. Underscores between word characters become spaces. Comparison operators
such as `5 < 7`, currency, emoji, and non-Latin scripts remain available for
speech. Use it for plain or lightly formatted prose.

```python
# src/examples/generic/pipeline.py
from examples.shared.nemotron_speech_text_filter import NemotronSpeechTextFilter

tts = NvidiaTTSService(
    ...
    text_filters=[NemotronSpeechTextFilter()],  # default
)
```

#### `NemotronSpeechMarkdownTextFilter`

Extends Pipecat's `MarkdownTextFilter` with the same reserved-character strip. Use it when the LLM streams Markdown. All `MarkdownTextFilter` settings (`filter_code`, `filter_tables`) are inherited.

```python
# src/examples/generic/pipeline.py
from examples.shared.nemotron_speech_text_filter import NemotronSpeechMarkdownTextFilter

tts = NvidiaTTSService(
    ...
    text_filters=[NemotronSpeechMarkdownTextFilter()],
)
```

### Preview and Upload Voices in the Astra Client

Before starting a session, select **Voice** in the launch bar below the
example cards to open the `/voice` studio. Choose a catalog **Speech engine**,
then a **Speaking voice** card. The scrollable gallery shows voice names and language details without a
dropdown or collapsed section. Larger catalogs offer **Find a voice** search
by name or expression and show a matching count. Enter up to 200 characters
and select **Preview voice**.
Preview uses `POST /api/tts/preview` and returns WAV audio. Engines, voices,
languages, and samples are pre-session choices; end the session before
changing them. **Audio settings** appears on the conversation page and opens
only microphone and speaker selectors. The studio lists available deployment
engines, including Magpie Zeroshot when enabled. Select **Back to setup** to
return to the landing page.

For the Frontend/Backend Agent or Omni Subagents, select Magpie Zeroshot
to use a reference voice. Under **Create a character voice**, upload
3–10 seconds of clear speech, then enable **Use sample for zero-shot voice**. The browser converts the clip to
22.05 kHz, 16-bit mono PCM WAV and stores it in IndexedDB for that browser
profile and origin. The input file is limited to 10 MB. **Remove sample**
deletes the saved clip. The use checkbox is explicit; uploading alone does not
activate the sample. The saved clip persists across reloads, but the checkbox
resets off; enable it again to use the sample. Preview uses the sample when
this checkbox is enabled.
Preset voice selection is disabled while the sample supplies the voice. The
service sets Riva's required `voice_name` to `Magpie-ZeroShot-Multilingual`
for validated reference audio, rather than a built-in Female or Male preset.

The client sends `tts_voice_sample` as base64 WAV in the next session
configuration, so application replicas do not need a shared sample path.
The server accepts at most 1,000,000 decoded bytes, 3–10 seconds, mono 16-bit
PCM, and sample rates from 22.05 to 48 kHz. Samples require a compatible
Magpie Zeroshot model. Chatterbox Multilingual NIM 1.1.0 rejects audio prompts,
so its catalog voices remain available without sample cloning. Client
filesystem paths are not accepted.
Other examples keep their catalog-based audio-prompt configuration below.

### Voice Cloning / Zero-Shot

Magpie TTS Zeroshot clones a voice from a short reference clip using Pipecat's `NvidiaTTSService(zero_shot_audio_prompt_file=...)`. Set the path only in catalog YAML (`services.local.yaml`); it is not accepted from the client session body. Refer to [voice cloning](https://docs.nvidia.com/nim/speech/latest/tts/voice-cloning.html) for details.

1. Enable the Zeroshot sidecar and select `magpie-zeroshot-tts` (see [Hardware requirements](#hardware-requirements-and-deployment-configs)).
2. Prepare a 16-bit mono WAV (sample rate ≥ 22.05 kHz, about 3–10 seconds).
3. In the example's `services.local.yaml` (`server`), keep or set `voice_id` to a built-in such as `Magpie-ZeroShot-Multilingual.Female`, and add an **absolute path visible to the voice-agent process**:

   ```yaml
   magpie-zeroshot-tts:
     ...
     zero_shot_audio_prompt_file: "/data/prompts/clone.wav"
   ```

   - **Host-native** (`uv run` / local Python): use a host absolute path (for example `/home/you/prompts/clone.wav`).
   - **Compose / Docker**: mount the file into the app service for your Compose profile (for example `generic-assistant` with `--profile generic-assistant`, or `generic-assistant-server` with `--profile generic-assistant/server`). Use a Compose override, then set `zero_shot_audio_prompt_file` to that **container** absolute path. Relative paths are not resolved from the repo root.

     ```yaml
     # docker-compose.override.yaml (example for --profile generic-assistant)
     services:
       generic-assistant:
         volumes:
           - /home/you/prompts/clone.wav:/data/prompts/clone.wav:ro
     ```

   The catalog field is hydrated as `tts_zero_shot_audio_prompt_file` and passed into `NvidiaTTSService`.
4. Start a session.

Omit `zero_shot_audio_prompt_file` to use only built-in Zeroshot voices.

## Reference

- [Troubleshooting guide](../06-troubleshooting.md#tts-text-to-speech): reserved-character synthesis failures, mispronunciations, and long-input limits.
- [Configure Services](configure-services.md): how the catalog is loaded, switched, and overridden.
- [NVIDIA NIM for Speech — TTS](https://docs.nvidia.com/nim/speech/latest/tts/index.html): [available voices & emotions](https://docs.nvidia.com/nim/speech/latest/tts/voices.html), [customization / pronunciation](https://docs.nvidia.com/nim/speech/latest/tts/customization.html), [phoneme support](https://docs.nvidia.com/nim/speech/latest/tts/phoneme-support.html), [voice cloning (zero-shot)](https://docs.nvidia.com/nim/speech/latest/tts/voice-cloning.html), [performance benchmarks](https://docs.nvidia.com/nim/speech/latest/reference/performances/tts/performance.html), [TTS troubleshooting](https://docs.nvidia.com/nim/speech/latest/troubleshooting/tts.html).
- [Pipecat NVIDIA TTS service](https://github.com/pipecat-ai/pipecat/blob/main/src/pipecat/services/nvidia/tts.py).
