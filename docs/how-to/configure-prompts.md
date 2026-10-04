# Configure Prompts

You can customize your voice agent's personality, behavior, and response format using system prompts. Built-in prompts are defined in example-local `prompts.yaml` files. Choose or edit session prompts through the client UI.

## Switching / Adding Prompts via the UI

Choose or edit prompts before starting a session. End the current session before applying different instructions.

The upstream client includes a **Prompts** tab for custom presets. The Astra
client provides the separate pre-session editor described below.

In the Astra client, select **Prompts** beside **Configure** in the launch bar
below the example cards to open `/prompts`. **Edit prompts** inside the
configuration popup opens the same editor. Select **Back to setup** to return.
**Settings** and **Pipeline info** open over the editor; closing them returns
to the same prompt page. Editing and restoring
defaults are disabled while a session is starting or live, and while prompt
defaults load. Wait for **Loading system prompt defaults…** to clear before
editing. Edit **Frontend system prompt** for spoken responses and, when
available, **Backend system prompt** for planning. Frontend/Backend Agent and
Omni Subagents expose their Thinker prompt in this editor. Other Omni agent
prompts remain in `agent_prompts:` in the example's `prompts.yaml`.

For more room, select **Expand editor** on either role card. The dialog fills
most of the window and wraps the prompt in a monospace editor. Select a text
size from 14 to 22 pixels in 2-pixel steps to suit your display. Edits save
immediately to the same browser overrides as the compact fields; there is
no separate save step. **Restore frontend default** or
**Restore backend default** resets only the open role. Select **Done** or
press **Escape** to close the dialog and return focus to **Expand editor**.
Expansion and editing are disabled under the same session and loading
conditions as the compact editor. Both sizes retain the 32,000-character
limit. Expanding a role does not change **Persistent instructions**.

An unedited Astra session uses the selected frontend catalog prompt shown in
the editor, including its native examples. The client sends its catalog key
without substituting a separate demo prompt. Your saved edits replace that
content, and persistent instructions append as described below.

The editor saves frontend and backend overrides separately for each pipeline
in browser localStorage. **Persistent instructions** are shared across pipelines
and appended to both roles when supported, whether you use defaults or edit
either role. They survive reloads and restoring either default; clear their
field to remove them.
Changes apply when you start a new session. Storage is specific to the browser
profile and origin.

## Frontend/Backend Session Prompts

The Frontend/Backend Agent and Omni Subagents accept these text fields in
`POST /api/session-config`:

| Field | Behavior |
| --- | --- |
| `prompt_content` | Replace the selected frontend prompt for the new session. |
| `thinker_prompt_content` | Replace the Thinker prompt content for the new session. Role and domain selection remain server-owned. |
| `persistent_prompt` | Append the same editable instructions after both selected role prompts, including overrides. Omit it to add no user-authored persistent instructions. |

Each field accepts at most 32,000 characters. The API configures the new
session without updating `prompts.yaml`. The Astra editor provides the browser
persistence described above. `GET /api/prompts` identifies frontend and backend
roles, including the Omni `ThinkerAgent`, so the editor can separate them.

Generic Frontend/Backend Agent keeps its trusted native tool-call examples
when you edit the frontend persona or choose another prompt key. These examples
teach asynchronous weather delegation and architecture presentation
independently of editable text. There is no clock-result demonstration;
current-time requests require a fresh clock tool result. Other Frontend/Backend domains
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

### Generic Standing Response Policy

Generic keeps a code-owned spoken-response baseline separately from editable
**Persistent instructions**. It requests the shortest complete answer in
1 sentence, normally 10–20 words and at most 35. Capability replies use at most
25 words. Broad requests such as “Tell me about Sales Cloud” still receive
brief answers; explicitly ask for detail, steps, a list, a comparison, or
multiple facts to request expansion.

The policy retains persona tone, required exact responses, grounded values,
units, subjects, success/failure status, and critical safety information.
Necessary results and explicit detail requests can require longer answers.
These limits are model guidance, not deterministic truncation or a guaranteed
word cap. Direct tool formatters keep their separate result contracts.

The policy follows the edited persona, persistent instructions, and native
protocol examples as the final pinned initial system message. History trimming
preserves it, and temporary per-turn guidance repeats it without changing
saved native messages. Editing or restoring role prompts does not remove this
baseline or your saved editable persistent instructions. Refer to the
[Generic response policy](../../src/examples/frontend_backend_agent/src/response_policy.py)
for the maintained guidance. Other domains retain their policies.

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
