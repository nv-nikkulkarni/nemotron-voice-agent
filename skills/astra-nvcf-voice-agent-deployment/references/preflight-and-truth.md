# Preflight and Sources of Truth

## Contents

1. [Evidence Classes](#evidence-classes)
2. [Repository Preflight](#repository-preflight)
3. [Control Plane Map](#control-plane-map)
4. [Authentication Preflight](#authentication-preflight)
5. [Safe NVCF Inventory](#safe-nvcf-inventory)
6. [Safe Astra Inventory](#safe-astra-inventory)
7. [Checked-In Sources](#checked-in-sources)
8. [Status Record](#status-record)

## Evidence Classes

Label every operational statement:

- **Checked-in:** derived from the current branch, Helm render, values, Dockerfile, or
  immutable artifact metadata.
- **Live-verified:** queried from the relevant control plane during the current task. Record
  the date, time zone, CLI version, organization, and environment.
- **Historical:** preserved in a dated report, release manifest, or prior control-plane
  snapshot. It can explain history but cannot establish present state.
- **Unqualified:** built, published, deployed, or smoke-tested without the complete required
  SQA gates.

Do not promote a historical value to live truth because its function ID or hostname still
looks familiar. Do not call NVCF `ACTIVE` proof of model readiness or functional quality.

## Repository Preflight

Run these commands before any build or mutation:

```bash
pwd
git status --short --branch
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git remote -v
git worktree list --porcelain
git log --oneline --decorate -20
```

For the active deployment-development line, the intended branch is
`dev/nikkulkarni/nvcf-deploy-rebased-v2`. Verify it rather than choosing a checkout from
its directory name. Preserve untracked recovery evidence and unrelated modifications.

Refresh references only when network access and the task permit it:

```bash
git fetch origin --prune
git fetch upstream --prune
git rev-parse origin/dev/nikkulkarni/nvcf-deploy-rebased-v2
git merge-base --is-ancestor upstream/develop HEAD
```

Do not rebase, merge, force-push, or clean the tree as part of a deployment preflight.
Those are separate source-control operations.

## Control Plane Map

Treat each plane independently:

| Plane | Owns | Primary tools |
|---|---|---|
| GitHub fork | source branch and commits | Git |
| NGC image registry | app, UI, wrapper, and model container tags/digests | Docker, NGC CLI |
| NGC chart registry | packaged Helm chart versions | Helm, NGC CLI |
| Viking | local Kubernetes qualification | kubectl, Helm |
| NVCF function API | immutable function versions and secrets | NGC CLI |
| NVCF deployment API | GPU placement, scaling, concurrency, live deployment | NGC CLI |
| NVCF instance API | instances, pods, containers, logs, diagnostic exec | NGC CLI |
| Astra/Fusion | UI deployment, GitOps revisions, Vault references, environment promotion | Fusion CLI |
| Browser/public endpoint | effective UI config, HTTP, WebSocket, audio | curl, browser/SQA |

A function version is not a deployment. An Astra application is not the NVCF function.
An NGC chart is not a generic NGC resource.

## Authentication Preflight

Check tools without printing tokens:

```bash
docker version
helm version
ngc --version
fusion --version
fusion auth
fusion platform
fusion config
kubectl config current-context
```

Use installed CLI `--help` before copying a historical command. The checked host had NGC
CLI 4.36.6 on October 02, 2026. Fusion 0.34.0 was installed but its authentication token
was expired. The installed Fusion skill has its own version gate; load it before any Fusion
operation. Do not upgrade a CLI in the middle of a deployment without explicit approval.

Authentication domains are separate:

- `docker login nvcr.io` authorizes container pushes and pulls.
- NGC CLI configuration authorizes registry and NVCF control-plane operations.
- An NVIDIA invocation key authorizes calls to a function.
- Fusion login authorizes Astra/Fusion operations.
- Artifactory authentication authorizes Astra UI image publication.
- kubectl credentials authorize Viking.

Success in one domain does not prove access in another.

## Safe NVCF Inventory

Always specify the intended organization and team when they are known. Query function
versions and deployments separately:

```bash
ngc cf fn list \
  --org <org> --team <team> \
  --name-pattern 'nemotron-*' \
  --format_type json

ngc cf fn deploy list \
  --org <org> --team <team> \
  --format_type json
```

For one function:

```bash
ngc cf fn list <function-id> --format_type json
ngc cf fn info <function-id>:<version-id> --format_type json
ngc cf fn deploy info <function-id>:<version-id> --format_type json
ngc cf fn instance list <function-id>:<version-id> --format_type json
```

Project broad output to non-secret fields before retaining it:

```bash
ngc cf fn deploy list --format_type json |
  jq '[.[] | {
    functionName,
    functionId,
    functionVersionId,
    deploymentId,
    functionStatus,
    lastUpdatedAt,
    specs: [.deploymentSpecifications[] | {
      backend, instanceType, gpu, gpuMemory,
      minInstances, maxInstances, maxRequestConcurrency
    }]
  }]'
```

Do not assume `ngc cf fn list` returns the same schema across CLI versions. Inspect keys
with `jq '.[0] | keys'`, then use the installed field names.

## Safe Astra Inventory

After loading the Fusion skill and authenticating, set or confirm the platform and
environment explicitly:

```bash
fusion platform
fusion config
fusion auth
fusion deploy list -d <deployment-layer>
fusion deploy status -d <deployment-layer> -r <deploy-repo> -e <stg-or-prd>
fusion deploy export -d <deployment-layer> -r <deploy-repo> -e <stg-or-prd>
fusion deploy manifests -d <deployment-layer> -r <deploy-repo> -e <stg-or-prd>
```

Exported values and manifests can contain internal hosts and references. Store them only in
an approved temporary location, review before sharing, and never paste a full export into a
report.

Do not run `fusion vault get` in a captured transcript unless the installed CLI provides a
verified names-only mode. It can print secret values. Prefer deployment references, Secret
names, and effective public endpoint checks.

## Checked-In Sources

Verify deployment claims against these files:

| Concern | Source |
|---|---|
| chart identity | `nvcf_helm/Chart.yaml` |
| production defaults | `nvcf_helm/values.yaml` |
| Viking overlay | `nvcf_helm/values-viking.yaml` |
| templates and service names | `nvcf_helm/templates/` |
| app image | `docker/Dockerfile` |
| Astra UI image/proxy | `docker/Dockerfile.nvcf-ui`, `docker/nginx-nvcf.conf.template` |
| runtime UI config | `docker/nvcf-ui-entrypoint.sh` |
| Astra values | `nemotron-voice-agent-values.yaml` and environment-specific values |
| current architecture record | `docs/current-deployed-pipeline-architecture.md` |
| SQA gate truth | `tests/sqa/README.md`, `tests/sqa/reports/` |
| broader operating context | `skills/operate-nemotron-voice-agent/` |

A chart can intentionally use a different target-overlay image tag from its base values.
Render the exact target values rather than comparing isolated YAML lines.

## Status Record

Capture this minimum state before mutation:

```text
Observation time and time zone:
Repository path:
Branch and full SHA:
Worktree cleanliness:
NGC organization/team:
Target artifact repositories and versions:
Target function name/ID/version:
Serving deployment ID and instance shape:
Rollback function/version/deployment:
Astra platform/environment/repo/revision:
Astra backend function ID:
Viking context/namespace/release:
Authentication gaps:
Qualification status:
```

Save no token, key, Vault value, prompt, or internal URL that is unnecessary for the
operation.
