# Artifacts and Registries

## Contents

1. [Artifact Identity](#artifact-identity)
2. [Repository Isolation](#repository-isolation)
3. [Clean Build Context](#clean-build-context)
4. [Build and Push the App Image](#build-and-push-the-app-image)
5. [Build and Push the Astra UI](#build-and-push-the-astra-ui)
6. [Package and Push the Helm Chart](#package-and-push-the-helm-chart)
7. [Verify Immutable Artifacts](#verify-immutable-artifacts)
8. [Secret and Provenance Scans](#secret-and-provenance-scans)
9. [Artifact Cleanup](#artifact-cleanup)

## Artifact Identity

Allocate immutable identities before building:

```text
source branch + full SHA
app repository:tag + OCI index digest + AMD64 digest
UI repository:tag + OCI index digest + AMD64 digest + build timestamp
chart repository:version + package SHA-256 + NGC upload timestamp
build host/toolchain versions
validation summary
```

Never overwrite a qualified tag. A failed candidate receives a new patch version. Do not
reuse a lost, partial, or accidentally published version number.

Push images before charts. The chart must reference an image tag that already resolves in
the registry.

## Repository Isolation

Use dedicated repositories for distinct products:

| Product | Image repository | Chart repository |
|---|---|---|
| main production voice agent | `0491162300748285/nemotron-voice-agent` | `0491162300748285/nemotron-voice-agent` |
| Realtime Generic Frontend/Backend | `0491162300748285/nemotron-realtime-generic-fba` | `0491162300748285/nemotron-realtime-generic-fba` |
| dedicated speech wrappers | dedicated `nvcf-*` image repositories | container functions; no main chart |
| Astra UI | approved Astra Artifactory repository | Fusion values, not the NVCF chart |

Do not publish an experimental Realtime, standalone model, or speech-wrapper artifact into
the main production repositories. Historical mistaken main-repository artifacts were
deleted only after the serving function's exact chart/image references were proven and the
user explicitly authorized deletion.

Before any deletion, inspect all function versions and charts that reference the target.
Artifact deletion is not a normal cleanup step.

## Clean Build Context

Require a clean committed tree:

```bash
git status --short
git rev-parse HEAD
git diff --check
```

Build from a committed archive rather than a dirty worktree:

```bash
release_root="$(mktemp -d)"
git archive --format=tar HEAD | tar -xf - -C "$release_root"
```

Record the temporary path and remove it only after artifacts and manifests are verified.
Do not include `.env`, credentials, raw SQA WAV/JSON, caches, model weights, session
archives, or local recovery outputs.

## Build and Push the App Image

Authenticate interactively so the password does not appear in the command or shell history:

```bash
docker login nvcr.io --username '$oauthtoken'
```

Build Linux AMD64 with source labels:

```bash
docker buildx build \
  --platform linux/amd64 \
  --file "$release_root/docker/Dockerfile" \
  --build-arg APP_VERSION="<app-version>" \
  --build-arg SOURCE_SHA="<full-source-sha>" \
  --tag "nvcr.io/<org>/<image-repository>:<app-version>" \
  --push \
  "$release_root"
```

For the main product, `<image-repository>` is `nemotron-voice-agent`. Use the dedicated
Realtime or wrapper repository for other functions.

Verify registry identity:

```bash
docker buildx imagetools inspect \
  "nvcr.io/<org>/<image-repository>:<app-version>"
ngc registry image info \
  "<org>/<image-repository>:<app-version>" --details
```

Record both the OCI index digest and the Linux AMD64 manifest digest. NVCF runs AMD64; a
local ARM64-only image is not deployable there.

## Build and Push the Astra UI

The UI Dockerfile builds the React application and a non-root nginx proxy. Build with
explicit metadata:

```bash
docker buildx build \
  --platform linux/amd64 \
  --file "$release_root/docker/Dockerfile.nvcf-ui" \
  --build-arg UI_VERSION="<ui-version>" \
  --build-arg SOURCE_SHA="<full-source-sha>" \
  --build-arg UI_BUILD_TIMESTAMP="<UTC-RFC3339>" \
  --tag "<approved-astra-registry>/<ui-repository>:<ui-tag>" \
  --push \
  "$release_root"
```

The established Astra repository is defined in the active Fusion values file. Verify its
current value rather than copying a historical path.

The UI image is function-agnostic. At runtime, server-side environment/Vault values select
the NVCF host, function ID, and invocation credential. Never include those values in the
bundle or OCI labels.

If Artifactory authentication is unavailable, stop and restore it. Do not silently publish
the production UI into an unrelated NGC repository and then claim Astra uses it.

## Package and Push the Helm Chart

Verify and render the target:

```bash
helm lint nvcf_helm -f <target-values.yaml>
helm template <release-name> nvcf_helm \
  -f <target-values.yaml> > <temporary-rendered-manifest>
```

Inspect image repositories/tags, service names, GPU limits, secret references, enabled
workloads, storage, capture, Redis, and readiness gates. Never commit the rendered manifest
if it contains environment-specific internal details.

Package into a dedicated directory:

```bash
chart_dir="$(mktemp -d)"
helm package nvcf_helm --destination "$chart_dir"
sha256sum "$chart_dir"/<chart-name>-<chart-version>.tgz
```

Push with the **chart** API. With NGC CLI 4.36.6, `--source` is the directory that
contains the packaged chart:

```bash
ngc registry chart push \
  "<org>/<chart-repository>:<chart-version>" \
  --source "$chart_dir"
```

Do not run `ngc registry resource upload-version` for a Helm chart. That API creates a
generic resource that NVCF does not consume.

Pull and compare:

```bash
verify_dir="$(mktemp -d)"
ngc registry chart pull \
  "<org>/<chart-repository>:<chart-version>" \
  --dest "$verify_dir"
sha256sum "$verify_dir"/<chart-name>-<chart-version>.tgz
```

Require the local and pulled package checksums to match.

## Verify Immutable Artifacts

Inspect labels and architecture without printing environment values:

```bash
docker buildx imagetools inspect "<image-ref>"
ngc registry image info "<org>/<repo>:<tag>" --details
helm show chart "<pulled-chart-package>"
helm show values "<pulled-chart-package>" | rg -n 'repository:|tag:|enabled:|replicas:'
```

Create a release manifest that includes no secrets:

```text
source SHA
image and UI references/digests
chart reference/checksum
upload-complete timestamps
dependency lockfile checksums
build timestamp/tool versions
validation and qualification state
```

A registry upload proves existence, not deployability. NVCF must still pull, schedule,
start, warm, and serve the artifact.

## Secret and Provenance Scans

Scan before push and after packaging:

- complete Git diff and each new or rewritten commit;
- image history, config, labels, and extracted application source;
- UI bundle and `config.js`;
- chart package and target render;
- release manifest, reports, and logs; and
- ignored/untracked files before copying them into the build context.

Run repository pre-commit private-key detection and Gitleaks. Search for credential shapes
without persisting matching values. A reviewed placeholder fingerprint does not exempt a
file from future scans.

Confirm OCI labels reference a real commit. One UI image was functionally correct but had
an expanded source SHA that did not exist. It was superseded with a corrected immutable
tag rather than relabeled in place.

## Artifact Cleanup

Deletion requires explicit authorization and exact target resolution:

```bash
ngc registry image info "<org>/<repo>:<tag>" --details
ngc registry chart pull "<org>/<chart>:<version>" --dest <temporary-directory>
```

Then prove no active or retained rollback function references it. If authorized, the
installed CLI provides:

```bash
ngc registry image remove "<org>/<repo>:<tag>"
ngc registry chart remove "<org>/<chart>:<version>"
```

Do not use wildcards or `-y` during target discovery. After deletion, verify absence and
re-query every serving function. Report what was deleted and that registry deletion is not
recoverable without rebuilding or another retained copy.
