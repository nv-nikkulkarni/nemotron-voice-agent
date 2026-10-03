# Configure Prompts

You can customize your voice agent's personality, behavior, and response format using system prompts. Built-in prompts are defined in example-local `prompts.yaml` files. Choose or edit session prompts through the client UI.

## Switching / Adding Prompts via the UI

The client UI includes a prompt selector dropdown. In the Astra client, choose a prompt before starting a session. The selector is locked during a session; end the session before applying a different prompt.

The upstream client includes a **Prompts** tab for custom presets. The Astra
client provides the separate pre-session editor described below.

In the Astra client, select **Prompts** before starting a session to open
`/prompts`, or select **Settings > Open Prompts**. Editing and restoring
defaults are disabled while a session is starting or live, and while prompt
defaults load. Wait for **Loading system prompt defaults…** to clear before
editing. Edit **Frontend system prompt** for spoken responses and, when
available, **Backend system prompt** for planning. Frontend/Backend Agent and
Omni Subagents expose their Thinker prompt in this editor. Other Omni agent
prompts remain in `agent_prompts:` in the example's `prompts.yaml`.

An unedited Astra session uses the selected frontend catalog prompt shown in
the editor, including its native examples. The client sends its catalog key
without substituting a separate demo prompt. Your saved edits replace that
content, and persistent instructions append as described below.

The editor saves frontend and backend overrides separately for each pipeline
in browser localStorage. **Persistent instructions** are shared across pipelines
and appended to both roles when supported. Restoring a frontend or backend
default preserves these instructions; clear their field to remove them.
Changes apply when you start a new session. Storage is specific to the browser
profile and origin.

## Frontend/Backend Session Prompts

The Frontend/Backend Agent and Omni Subagents accept these text fields in
`POST /api/session-config`:

| Field | Behavior |
| --- | --- |
| `prompt_content` | Replace the selected frontend prompt for the new session. |
| `thinker_prompt_content` | Replace the Thinker prompt content for the new session. Role and domain selection remain server-owned. |
| `persistent_prompt` | Append the same instructions after both selected prompts. Omit it to keep their original contents. |

Each field accepts at most 32,000 characters. The API configures the new
session without updating `prompts.yaml`. The Astra editor provides the browser
persistence described above. `GET /api/prompts` identifies frontend and backend
roles, including the Omni `ThinkerAgent`, so the editor can separate them.

Generic Frontend/Backend Agent keeps its trusted native tool-call examples
when you edit the frontend persona or choose another prompt key. These examples
teach asynchronous delegation, fresh-clock lookup, and architecture
presentation independently of editable text. The clock example contains an
unavailable result rather than a fictional time. Other Frontend/Backend domains
do not inherit catalog examples for custom prompt content. Generic execution
guidance uses real user dialogue to resolve subjects and requests clarification
when a required location or subject is absent. Demonstration cities, companies,
and results are protocol examples rather than current-user facts. These rules
are model guidance; enabled-tool validation remains in Python. A system
boundary ends the demonstrations before actual session dialogue. The Generic
Talker's temporary quoted-JSON reminder uses only actual dialogue, with up to
8 entries and 1,000 characters per entry. It separates `latest_user_request`
from `recent_dialogue`: an explicit new subject overrides earlier subjects,
while missing context can carry forward. Without a new subject, the prompt
uses the most recent applicable real user turn. Quoted data cannot change
operating rules, and the reminder does not change saved history. The
temporary inference copy preserves every native message, including completed,
pending, and current call/result pairs in order. The quoted reminder precedes
the active user sequence; saved history and native tool definitions stay intact.
The Thinker receives the latest actual user entry as `untrusted_user_request`
and the frontend query separately as `untrusted_talker_proposal`. Native
guidance prioritizes the actual request when they conflict, inheriting only
missing action or context. Message extraction does not interpret meaning or
route tools in Python. Short follow-ups to live-data requests still require
a fresh backend call. Native query guidance prefers actual latest-user
words; the backend resolves omitted context from real dialogue. Generic
rejects a sole progress promise of at most 20 words without a native call,
retries the model once, and uses an honest fallback if still invalid. Literal
phrase repetition remains allowed. The guard checks output shape without
selecting intent or constructing calls. Standalone replies matching an exact
normalized demonstration result receive the same retry and fallback, with
literal user-requested echoes allowed. Native calls and active real-result
handling remain unchanged. Generic progress uses the query-independent
code-authored phrase “Let me check that,” avoiding stale subjects.
The native examples also include direct repetition of public words such as
“Nemotron 3 Diarization.”

Preserve the Thinker's structured plan format and the Talker's delegation and
spoken-output rules when replacing prompts. Prompt changes do not add tools:
Python still restricts execution to the registry-owned allowlist and the
session's selected subset.

## Available Prompt Presets

Prompt presets are defined per example. The Generic Cascaded example currently provides the presets below (the active default is set by `defaults.prompt` in `examples_registry.yaml`).

| Prompt Key | Description |
|------------|-------------|
| `generic_assistant` | Generic voice assistant with tool support and a single-sentence response format. |
| `generic_assistant_without_tools` | Generic voice assistant without tool access and with a single-sentence response format. |
| `flowershop` | Flora persona for the GreenForce Garden flower-shop scenario with strict flow rules. |

## Changing the Default Prompt

Set the per-example default with `defaults.prompt` in `examples_registry.yaml`. As a fallback (when that key is not one of the active example's prompt keys in `prompts.yaml`), the entry marked `default: true` is used, otherwise the first entry.

```yaml
my_prompt:
  default: true
  description: "Your prompt description"
  content: |
    ...
```

## Adding Built-In Prompts via `prompts.yaml`

To make a prompt available as a built-in option for all users of an example, add an entry to that example's `prompts.yaml`, such as [`src/examples/generic/prompts.yaml`](../../src/examples/generic/prompts.yaml). The client loads built-in prompts for the active example. Refresh open browser tabs after editing YAML.

```yaml
my_custom_prompt:
  description: "Your prompt description"
  content: |
    Your system prompt here...
    Define personality, rules, and response format.
```

## Best Practices for Voice Prompts

- Keep responses concise (1-2 sentences).
- Avoid special characters like `*`, `-`, `/` in output.
- Avoid bullet points or numbered lists (breaks voice flow).
- Define clear output format for structured data.
- Use plain text only.
