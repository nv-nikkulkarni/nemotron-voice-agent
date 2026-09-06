{{/*
Expand the name of the chart.
*/}}
{{- define "nemotron-voice-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
Truncated at 63 chars because DNS naming spec.
*/}}
{{- define "nemotron-voice-agent.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label value: name-version.
*/}}
{{- define "nemotron-voice-agent.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "nemotron-voice-agent.labels" -}}
helm.sh/chart: {{ include "nemotron-voice-agent.chart" . }}
{{ include "nemotron-voice-agent.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (used in matchLabels + podLabels).
*/}}
{{- define "nemotron-voice-agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nemotron-voice-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Image pull secrets. Includes, in order:
  - a chart-created dockerconfigjson secret (when imagePullSecret.create=true and
    a key is provided) — use this when the platform-injected pull secret lacks
    registry access to ngcImageRegistryPath;
  - the platform/pre-existing secret named by ngcImagePullSecretName (NVCF injects
    this at deploy time).
Renders nothing if neither is set (avoids an invalid empty entry).
*/}}
{{- define "nemotron-voice-agent.imagePullSecrets" -}}
{{- $names := list -}}
{{- if and .Values.imagePullSecret.create .Values.imagePullSecret.ngcApiKey -}}
  {{- $names = append $names (printf "%s-ngc-pull" (include "nemotron-voice-agent.fullname" .)) -}}
{{- end -}}
{{- if .Values.ngcImagePullSecretName -}}
  {{- $names = append $names .Values.ngcImagePullSecretName -}}
{{- end -}}
{{- if $names }}
imagePullSecrets:
{{- range $names }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Full image reference for the app container.
  nvcr.io/0491162300748285/nemotron-voice-agent:latest
*/}}
{{- define "nemotron-voice-agent.appImage" -}}
{{ .Values.ngcImageRegistry }}/{{ .Values.ngcImageRegistryPath }}/{{ .Values.appImage.name }}:{{ .Values.appImage.tag }}
{{- end }}

{{/*
Full image reference for the LLM NIM container.
  nvcr.io/0491162300748285/nemotron-3-nano:2.0.5
*/}}
{{- define "nemotron-voice-agent.llmImage" -}}
{{ .Values.ngcImageRegistry }}/{{ .Values.ngcImageRegistryPath }}/{{ .Values.llmImage.name }}:{{ .Values.llmImage.tag }}
{{- end }}

{{/*
Full image reference for the TTS NIM container.
  nvcr.io/0491162300748285/magpie-tts-multilingual:1.8.0
*/}}
{{- define "nemotron-voice-agent.ttsImage" -}}
{{ .Values.ngcImageRegistry }}/{{ .Values.ngcImageRegistryPath }}/{{ .Values.ttsImage.name }}:{{ .Values.ttsImage.tag }}
{{- end }}

{{/*
Full image reference for the ASR NIM container.
  nvcr.io/0491162300748285/nemotron-asr-streaming:1.2.0
*/}}
{{- define "nemotron-voice-agent.asrImage" -}}
{{ .Values.ngcImageRegistry }}/{{ .Values.ngcImageRegistryPath }}/{{ .Values.asrImage.name }}:{{ .Values.asrImage.tag }}
{{- end }}

{{/*
Full image reference for the Super 120B LLM NIM container.
  nvcr.io/0491162300748285/nemotron-3-super-120b-a12b:2.0.5
*/}}
{{- define "nemotron-voice-agent.llmSuperImage" -}}
{{ .Values.llmSuperImage.repository }}:{{ .Values.llmSuperImage.tag }}
{{- end }}

{{- define "nemotron-voice-agent.llmLightningImage" -}}
{{ .Values.llmLightningImage.repository }}:{{ .Values.llmLightningImage.tag }}
{{- end }}

{{/*
Full image reference for the Parakeet RNNT Multilingual ASR NIM container.
  nvcr.io/0491162300748285/parakeet-1-1b-rnnt-multilingual:1.5.0
*/}}
{{- define "nemotron-voice-agent.parakeetImage" -}}
{{ .Values.ngcImageRegistry }}/{{ .Values.ngcImageRegistryPath }}/{{ .Values.parakeetImage.name }}:{{ .Values.parakeetImage.tag }}
{{- end }}

{{/*
Full image reference for the Omni vLLM container (public image, full repository).
  vllm/vllm-openai:v0.20.0-cu130
*/}}
{{- define "nemotron-voice-agent.omniImage" -}}
{{ .Values.omniImage.repository }}:{{ .Values.omniImage.tag }}
{{- end }}

{{/*
Full image reference for the Chatterbox TTS NIM container (NGC NIM catalog path,
full repository like omniImage — not the org-path helper).
  nvcr.io/nim/nvidia/chatterbox-tts-multilingual:1.0.0
*/}}
{{- define "nemotron-voice-agent.chatterboxImage" -}}
{{ .Values.chatterboxImage.repository }}:{{ .Values.chatterboxImage.tag }}
{{- end }}

{{/*
NGC_API_KEY env block — injected into every NIM container.
On NVCF (nvcf=true) this is omitted because the API key is instead
extracted at startup via nemotron-voice-agent.nimStartCommand below.
On-prem uses nim.existingSecret/Key so a broader key (model-download
permissions) can be supplied separately from the app's NVIDIA_API_KEY.
*/}}
{{- define "nemotron-voice-agent.ngcApiKeyEnv" -}}
{{- if not .Values.nvcf }}
- name: NGC_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.nim.existingSecret }}
      key: {{ .Values.nim.existingSecretKey }}
{{- end }}
{{- end }}

{{/*
NIM startup command — on NVCF, wraps start_server with API key extraction
from /var/secrets/secrets.json (injected by the NVCF platform into all
pods in the release). On-prem the NIM image's default entrypoint is used.
*/}}
{{- define "nemotron-voice-agent.nimStartCommand" -}}
{{- if .Values.nvcf }}
command:
  - /bin/sh
  - -c
  - |
    # NVCF injects function secrets as /var/secrets/secrets.json (not env vars).
    # Export NVIDIA_API_KEY / NGC_API_KEY from it so the NIM can authenticate its
    # NGC model-weight download. Portable extraction (no python/jq dependency).
    if [ -f /var/secrets/secrets.json ]; then
      key=$(grep -o '"NVIDIA_API_KEY"[[:space:]]*:[[:space:]]*"[^"]*"' /var/secrets/secrets.json | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
      if [ -n "$key" ]; then
        export NVIDIA_API_KEY="$key"
        export NGC_API_KEY="$key"
      fi
    fi
    # All three NIM images (LLM + Riva ASR/TTS) start via /opt/nim/start_server.sh
    # (the LLM as its entrypoint; ASR/TTS via $SERVER_START_SCRIPT_PATH which
    # points at the same path).
    exec /opt/nim/start_server.sh
{{- end }}
{{- end }}
