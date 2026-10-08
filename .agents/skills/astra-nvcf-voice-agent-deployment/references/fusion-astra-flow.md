# Fusion and Astra Flow

## Contents

1. [Architecture Boundary](#architecture-boundary)
2. [Load the Fusion Workflow](#load-the-fusion-workflow)
3. [Values and Runtime Proxy](#values-and-runtime-proxy)
4. [Create Staging](#create-staging)
5. [Update Staging](#update-staging)
6. [Inspect Argo and Runtime State](#inspect-argo-and-runtime-state)
7. [Promote Staging to Production](#promote-staging-to-production)
8. [Vault Handling](#vault-handling)
9. [Astra Verification](#astra-verification)
10. [Fusion Gotchas](#fusion-gotchas)

## Architecture Boundary

Astra serves the curated React UI through a non-root nginx container. It does not contain
the voice-agent model stack. nginx proxies:

- HTTP `/api/*` and `/health` to the per-function NVCF invocation host; and
- WebSocket `/api/ws` to `grpc.nvcf.nvidia.com`.

Server-side Vault values provide `NVCF_HOST`, `NVCF_FUNCTION_ID`, and
`NVIDIA_API_KEY`. nginx injects the authorization and function ID. The browser must never
receive those values.

The same UI image can target staging or production through different Vault and environment
configuration. Therefore UI image identity and backend function identity must be verified
separately.

## Load the Fusion Workflow

Load the installed `fusion` skill before using Fusion. Follow its version gate and platform
selection requirements. Do not install or upgrade Fusion merely to answer a status question
unless the user authorizes the host change.

Typical authentication preflight:

```bash
fusion --version
fusion auth
fusion platform
fusion config
fusion login --reauth
fusion auth
```

Fusion, NGC, Artifactory, and Git authentication are independent.

Select the target explicitly:

```bash
fusion platform use <platform>
fusion config --env stg
```

Before production, change and verify the environment rather than relying on the prior
shell's state.

## Values and Runtime Proxy

The values file owns:

- environment and application identity;
- deployment layer and owners;
- image repository/tag;
- UI build timestamp;
- session duration and curated examples;
- ingress hostname;
- Vault SecretStore, JWT path, role, and Kubernetes ServiceAccount; and
- the environment-specific shared-secret path.

All identity-bearing fields must agree. A preview app created with a `-deploy` suffix must
use that same identity in app name, hostname, SecretStore, JWT role, and Vault key.

The checked-in nginx proxy:

- fails closed if NVCF mode lacks `NVCF_HOST` or `NVIDIA_API_KEY`;
- derives the function ID from the host only when not supplied explicitly;
- keeps secrets out of `config.js`;
- strips browser cookies and upstream `Set-Cookie`;
- permits 50 MB media uploads; and
- uses one-hour read/send timeouts for voice WebSockets.

Inspect `docker/nginx-nvcf.conf.template`, `docker/nvcf-ui-entrypoint.sh`, and the active
values before every rollout.

## Create Staging

Use an isolated name and function target. Fusion appends `-deploy` to application
repositories and can reject environment keywords in names.

After `fusion ... --help` confirms syntax for the installed version, create with reviewed
values:

```bash
fusion deploy create \
  -n <app-base-name> \
  -d <deployment-layer> \
  -e stg \
  -c <astra-staging-cluster> \
  -f <staging-values.yaml> \
  --no-watch
```

A long-running command returns a task ID on supported Fusion versions. Track it:

```bash
fusion status <task-id>
fusion status <task-id> --watch
```

Creation can initialize the Vault path with template defaults. Patch only after the path and
identity are verified.

## Update Staging

For existing deployments, export current state first:

```bash
fusion deploy export \
  -d <deployment-layer> \
  -r <deploy-repo> \
  -e stg
```

Compare the export with the intended values. Then update:

```bash
fusion deploy update \
  -n <full-deploy-repository-url-or-installed-cli-required-name> \
  -d <deployment-layer> \
  -e stg \
  -f <staging-values.yaml> \
  -m "<concise-rollout-message>"
```

The accepted `-n`/repository form changed across Fusion versions. Confirm with installed
help after authentication. Historical Fusion 0.34 accepted the full GitLab deployment
repository URL for updates.

Do not update production values while testing staging. Do not rebuild the UI between
staging and production.

## Inspect Argo and Runtime State

Use:

```bash
fusion deploy list -d <deployment-layer>
fusion deploy status -d <deployment-layer> -r <deploy-repo> -e <env>
fusion deploy manifests -d <deployment-layer> -r <deploy-repo> -e <env>
fusion deploy metrics -d <deployment-layer> -r <deploy-repo> -e <env>
```

Record:

- platform, environment, cluster, deploy repository, and ingress;
- Argo revision, sync, health, creation/update time;
- image tag and digest;
- Vault path and role names, not values; and
- effective NVCF host/function ID through safe runtime checks.

Healthy/Synced means GitOps convergence. It does not prove NVCF readiness, WebSocket audio,
tool behavior, capture, or SQA.

## Promote Staging to Production

Require:

1. the exact staging UI digest and NVCF artifacts are qualified;
2. staging Argo is Healthy/Synced;
3. NVCF replacement is ACTIVE and functionally smoke-tested;
4. an explicit go/no-go exists;
5. the required NSPECT identifier is available; and
6. rollback identities are documented.

Use native replication rather than manually recreating production:

```bash
fusion deploy replicate \
  -d <deployment-layer> \
  -r <deploy-repo> \
  --from-env stg \
  --to-env prd
```

Follow the installed CLI's prompt/flag for NSPECT. Preserve the returned task ID and watch it
to completion.

Native replication previously:

- copied the staging UI deployment to a distinct production cluster/repository;
- transformed environment-specific JWT paths and Vault roles;
- copied Vault material server-side without printing values; and
- retained staging.

After replication, independently inspect production. A blank exported
`project.nspect_id` does not necessarily mean promotion lacked NSPECT; compare the Fusion
task audit. Record this as a metadata discrepancy, not automatic failure.

## Vault Handling

Astra needs these entries:

| Name | Purpose |
|---|---|
| `NVCF_HOST` | per-function HTTP invocation host |
| `NVCF_FUNCTION_ID` | NVCF routing header |
| `NVIDIA_API_KEY` | invocation-authorized upstream credential |

The path convention is:

```text
fusion/<platform>/<deployment-layer>/<deploy-repo>/<environment>
```

Use merge semantics when preserving existing keys:

```bash
fusion vault patch \
  -p "fusion/<platform>/<deployment-layer>/<deploy-repo>/<env>" \
  -s NVCF_HOST=<host> \
  -s NVCF_FUNCTION_ID=<function-id> \
  -s NVIDIA_API_KEY=<value-from-approved-secret-source>
```

`fusion vault put` replaces the complete value set and is higher risk. Use it only when
replacement is intended and the complete set is known.

The literal key value in a command can enter shell history or captured output. Use approved
secure injection, disable recording, and never paste the value into a report. Never run
`fusion vault get` in a captured transcript unless a verified names-only mode exists.

## Astra Verification

Check these boundaries:

1. Argo Healthy/Synced at the expected revision.
2. Public `/config.js` reports the expected non-secret build timestamp, examples, and
   session duration.
3. `/health` returns the expected backend health response. HTTP 200 with SPA HTML is not
   backend health.
4. A safe projection of `/api/deployment` reports the intended catalog and audio rates.
5. HTTP requests reach the intended function ID.
6. WebSocket returns 101, reaches bot readiness, and produces audio.
7. New-session restart rotates the session/socket/audio epoch and repeats the welcome.
8. One representative Generic tool turn and one Omni turn pass if those examples are
   advertised.
9. Capture status and one consented terminal outcome pass when capture is enabled.
10. Required SQA gates pass.

Do not expose full `/api/deployment` defaults in evidence. They can include prompts and
internal model URLs.

## Fusion Gotchas

- Authentication can appear configured while its token is expired. Trust `fusion auth`.
- Platform and environment are sticky across sessions. Set or verify both.
- CLI version drift changes flags and generated values. Run the installed skill's gate.
- `fusion vault get` can print values.
- An Astra UI can be new while targeting an old function, or old while targeting a new one.
- Secret refresh can lag Argo sync; verify the running pod/effective endpoint after patch.
- Browser WebSockets cannot set NVCF headers; nginx must inject them.
- The per-function invocation host is not the browser WebSocket gateway.
- Stale NVCF cookies can cause 404/1006 after a backend rollover; strip cookies both ways.
- Production is a separate cluster, role, Vault path, ingress, and NSPECT boundary.
- Retain staging until production verification completes.

## Move an Isolated UI to Main Staging

A main staging cutover can reuse published UI and backend artifacts. It does not require
an NVCF rebuild, a new function version, production replication, or deleting the isolated
app. Refer to [Current Staging Handoff](current-staging-handoff-2026-10-05.md) for the
October 05 example and immutable identities.

Export main staging values and record its Vault version, routing names, Argo state, and
public configuration before updating. Verify the existing staging invocation credential
can access the intended backend. Preserve that credential when it already works. Patch
only the routing entries and change only the required staging values.

Vault refresh and the runtime proxy can lag GitOps convergence. Record the ExternalSecret
state and actual serving pod after routing changes. An updated UI alongside HTML at
`/health` is incomplete readiness. Wait for the normal refresh and rollout, then check the
health body, effective HTTP route, WebSocket audio, and session-specific capture.
Do not infer a root cause from timing alone or rebuild NVCF to compensate.

Staging and production can watch the same deployment Git repository. A staging-only
values commit can advance both Argo revision strings. Compare the production values file,
Vault version and routing, public UI configuration, and serving state against the baseline.
A changed shared revision alone does not prove a production configuration mutation.

Run browser qualification against the exact requested public URL and record it in the
run metadata. An isolated `-2` URL does not qualify the main staging hostname. Preserve
both applications unless cleanup is explicitly authorized.
