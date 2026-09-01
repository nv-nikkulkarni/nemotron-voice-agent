# Isolated NVCF/Astra `-2` rollout — chart 0.1.130

## Decision

Chart `0.1.130` and app/UI `2.0.58` are deployed to the isolated
`nemotron-voice-agent-2` NVCF function and `nemotron-voice-agent-2-deploy` Astra
application. The owner explicitly authorized rollout despite a known Viking
conversation-oracle failure. Deployment smoke passed, but this is not a full
staging qualification or production approval.

## Immutable artifacts

| Artifact | Identity |
|---|---|
| Artifact source | `76ebbbd4416efa20265dd409f3869840c5b2a724` |
| App | `nvcr.io/0491162300748285/nemotron-voice-agent:2.0.58` (`sha256:aa011a9739175fd4590a63dec5e6478f42c6e37d0ec1ad81c95745b06f39437d`) |
| UI | `artifactory.nvidia.com/it-astra-docker-local/nemotron-voice-agent/nemotron-voice-agent-ui:2.0.58-76ebbbd4` (`sha256:083f2c027078c65e28a468b9591bb727d442c27ec194328e807c3088973b1b97`) |
| UI timestamp | `2026-08-31T22:03:25Z` |
| Chart | `0491162300748285/nemotron-voice-agent:0.1.130` |
| Chart package SHA-256 | `7b33532f4754fc087a0420740b6b3f8459a143aee2eeeb9b1ff0cfdbc8f3bd3e` |
| Astra-values source | `e05872a0` |

## Live deployment

| Item | Value |
|---|---|
| NVCF function | `nemotron-voice-agent-2` (`7886e141-cf95-4de5-9707-84cdfe048ddf`) |
| Active version | `1cc3541f-87c1-4a1c-b531-8c9984d4b419` |
| Deployment | `7e8e6b24-7a54-4455-9e06-3c01b5d745ee` |
| Backend | `nvcf-dgxc-k8s-oci-nrt-prd9-1`, H100, one instance, max concurrency 100 |
| Rollback | version `0597f1fe-5f82-4c4a-b285-11c15622dfb4` is inactive and retained |
| Astra app | `nemotron-voice-agent-2-deploy` |
| Astra URL | `https://nemotron-voice-agent-2-deploy-backend.stg.astra.nvidia.com` |
| Astra revision | `5fa09559ae53`, Synced and Healthy |
| Production | untouched |

The NVCF version received `NVIDIA_API_KEY`, `NGC_API_KEY`,
`PERPLEXITY_API_KEY`, `WEATHERAPI_KEY`, `FINNHUB_API_KEY`, and
`SESSION_CAPTURE_NGC` through function-version secrets. Values were read into
process memory from existing Viking Kubernetes secrets and were neither printed
nor committed. Astra continued using its existing Vault function identity
because the replacement is a version of the same function ID.

## Evidence and limitations

- Viking functional suite: 27 of 28 checks passed, with zero hard failures and
  one non-blocking landing-page pixel difference.
- Viking conversation suite: Generic passed all six real-audio turns. Omni
  produced speech and the correct answer `391`, but the suite rejected the
  semantically equivalent application-ASR transcript `Is 17 times 23.` because
  its new oracle accepted only spelled-out number forms.
- The owner explicitly authorized rollout with that known qualification gap.
- Astra smoke: Chromium connected over WebSocket; a real spoken Tokyo weather
  request survived application ASR, selected the expected live lookup path,
  produced bot audio, and was independently transcribed. Browser console errors
  and failed requests were both zero.
- Tuned Astra comprehensive Suite A: PASS. The harness first verifies the exact
  five-tool server-owned `generic_talker` catalog instead of requesting obsolete
  UI checkboxes. All 15 real-audio turns produced speech; Weather was called 3/3,
  Stock Price 2/2, Web Search 1/1, BMI 1/1, and Random Number 1/1. There were no
  hard failures, warnings, hangs, browser-console errors, bad HTTP responses, or
  WebSocket closures. Run ID: `20260901T051000Z-comprehensive-A-tuned`.
- Capture status through Astra reported upload required, upload ready, target
  configured, NGC CLI/key present, S3 storage, and zero pending or failed
  sessions.
- The remaining comprehensive, concurrency, corner, webcam, capture/NGC,
  robustness, guardrail, reconnect, and pronunciation suites have not been run
  against this Astra deployment.

Do not present this rollout as fully SQA-passed or promote it to production
without completing and reviewing the remaining staging gates.
