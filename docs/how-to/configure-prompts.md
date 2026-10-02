# Configure Prompts

You can customize your voice agent's personality, behavior, and response format using system prompts. Built-in prompts are defined in example-local `prompts.yaml` files. Choose or edit session prompts through the client UI.

## Switching / Adding Prompts via the UI

The client UI includes a prompt selector dropdown. In the Astra client, choose a prompt before starting a session. The selector is locked during a session; end the session before applying a different prompt.

The upstream client includes a **Prompts** tab for custom presets. The Astra
client provides the separate pre-session editor described below.

In the Astra client, select **Prompts** before starting a session to open
`/prompts`, or select **Settings > Open Prompts**. Editing and restoring
defaults are disabled while a session is starting or live. Edit **Frontend system prompt** for spoken responses and, when
available, **Backend system prompt** for planning. Frontend/Backend Agent and
Omni Subagents expose their Thinker prompt in this editor. Other Omni agent
prompts remain in `agent_prompts:` in the example's `prompts.yaml`.

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
