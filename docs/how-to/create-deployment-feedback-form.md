# Create the Astra and NVCF Deployment Feedback Form

Use this form to collect structured internal feedback for a specific Nemotron Voice Agent deployment on Astra and NVIDIA Cloud Functions (NVCF). It covers the Generic Frontend/Backend Agent and Nemotron Omni Assistant Subagents examples.

The form evaluates the complete deployed system. It does not evaluate an isolated model. The tested surfaces include automatic speech recognition (ASR), agent behavior, tool use, text-to-speech (TTS), browser audio, session lifecycle, and shared replica state.

## Understand the Form Scope

Ask each evaluator to submit one response per example and one primary session ID per response. The form uses section routing so an evaluator sees only the Generic or Omni questions, followed by the shared voice, reliability, safety, and evidence sections.

The form records these deployment identifiers:

| Identifier | Candidate Value |
| --- | --- |
| Deployment type | Astra and NVIDIA Cloud Functions production deployment |
| Application | `2.0.66` |
| UI | `2.0.67-2b07f747` |
| Helm chart | `0.1.138` |
| Expected UI deployed time | `2026-09-07T06:58:56Z` |

Update these values in `FORM_CONFIG` before creating a form for another release. Keep private deployment URLs out of Git. Set `evaluationUrl` in your private Apps Script copy.

## Create the Form

The generator uses the built-in Google Apps Script Forms service. It creates the form, publishes it, enables email collection, routes respondents by example, and optionally creates a linked response spreadsheet.

1. Open the [Google Apps Script dashboard](https://script.google.com/) with the account that will own the form.
2. Create a project and open `Code.gs`.
3. Copy the contents of `scripts/create-nemotron-voice-agent-feedback-form.gs` into `Code.gs`.
4. Review `FORM_CONFIG`. Set `evaluationUrl` only in Apps Script. Do not commit a private URL or credential.
5. Run `createNemotronVoiceAgentFeedbackForm`.
6. Review and accept the requested Forms and Sheets permissions.
7. Copy the responder, editor, and response-sheet URLs from the execution log.
8. Open the responder URL in a private browser window and submit one disposable test response.
9. Verify the example branch, required questions, response spreadsheet, email capture, and confirmation message.
10. Delete the disposable response before sharing the form.

The script creates a new form on every run. This prevents an accidental rewrite of an active evaluation form.

## Add the Screen-Recording Upload Item

Google does not currently support creating file-upload questions through Apps Script or the Forms API. The generated form therefore includes an **Evidence — Screen-recording, screenshot, transcript, or bug links** field.

To accept direct recordings, add one item manually in the final section:

1. Open the form editor.
2. Add a question after **Evidence — Screen-recording, screenshot, transcript, or bug links**.
3. Select **File upload** and acknowledge the Google Drive notice.
4. Name the item **Evidence — Upload screen recording or screenshots**.
5. Allow video and image files, up to five files, and the organization-approved maximum size.
6. Keep the item optional so an upload policy or quota does not block feedback submission.
7. Confirm that the owning account and response folder satisfy NVIDIA data-handling requirements before sharing the form.

Refer to the [Google Forms file-upload automation sample](https://developers.google.com/apps-script/samples/automations/upload-files) for Google Drive handling after the upload item exists.

## Review the Question Flow

The form uses the following sections:

| Section | Audience | Evidence Captured |
| --- | --- | --- |
| Before You Start | Everyone | Evaluator role, environment, session ID, artifact shown in the UI, time, browser, audio setup, and network |
| Generic Frontend/Backend Agent | Generic evaluators | Model pairing, selected capabilities, per-tool outcome, fresh lookup behavior, follow-up behavior, progress speech, terminal answer, and failure grounding |
| Nemotron Omni Assistant Subagents | Omni evaluators | Uploaded media, webcam baseline, high-resolution capture, gestures, Thinker escalation, source separation, scene isolation, and stuck analysis |
| Shared Conversation Quality | Everyone | Factuality, instruction following, context retention, response length, naturalness, emotional tone, trust, and stale answers |
| Responsiveness and Turn Taking | Everyone | End-of-turn latency, pause handling, back-channels, barge-in, cancellation, and replacement intent |
| Speech and Audio Quality | Everyone | Magpie or Chatterbox selection, speech rate, pitch, pronunciation, artifacts, truncation, missing audio, and gibberish |
| User Interface and Observability | Everyone | Onboarding, example and tool selection, controls, transcript, version display, and granular Real-Time Voice Interaction (RTVI) latency |
| Session and Deployment Reliability | Everyone | Welcome audio after no-refresh restart, unique session ID, cleared state, reconnect, cross-session isolation, and terminal failure behavior |
| Safety, Privacy, and Session Capture | Everyone | Safety categories, refusal quality, reasoning or secret leakage, capture consent, clean teardown, and operator-verified capture outcome |
| Issue Evidence and Overall Assessment | Everyone | Severity, reproduction steps, evidence links or uploads, satisfaction, release recommendation, and improvement priorities |

## Use the Suggested Coverage

For the Generic Frontend/Backend Agent, ask evaluators to try these categories:

- A direct conversational question that does not require a tool.
- Current weather and a follow-up location such as “How about London?”
- A current stock quote.
- Current news or a latest-information request, followed by “That answer seems old—check again.”
- A body mass index calculation with metric inputs.
- A bounded random-number request.
- A tool request followed by a real voice interruption or cancellation.
- A provider or malformed-input failure when the test coordinator has approved that test.

For Nemotron Omni Assistant Subagents, ask evaluators to try these categories:

- A normal voice conversation.
- An uploaded image, audio, or video analysis request.
- A live webcam scene description and a later follow-up.
- A high-resolution capture only after the low-resolution view lacks detail.
- Safe supported gestures: wave, open-palm stop, thumbs-up, and thumbs-down.
- A difficult request that can exercise the Thinker.
- A barge-in while the Speaker or analyzer result is active.
- Separate concurrent sessions when the evaluator has access to multiple approved browser contexts.

Do not ask evaluators to paste credentials, personal health details, customer content, or other confidential data into prompts or responses.

## Triage Responses

Use the session ID as the primary correlation key. Combine it with the example, timestamp, selected model, selected TTS, and exact reproduction steps.

Apply the following initial severity rubric:

| Severity | Use It For |
| --- | --- |
| P0 | Safety or privacy failure, cross-session leakage, data loss, or an unusable deployment |
| P1 | Major feature failure, repeated deadlock, missing final answer, or a consistently broken tool or media path |
| P2 | Degraded behavior with a workaround, intermittent stale answer, slow barge-in, or significant audio impairment |
| P3 | Cosmetic defect, minor wording issue, or isolated pronunciation problem |

Do not treat a subjective rating as proof of a backend defect. Reproduce the reported session against deployment logs, Real-Time Voice Interaction (RTVI) events, capture state, and provider outcomes before assigning root cause.

## Validate Before Distribution

Complete this checklist before sharing the responder URL:

- Confirm that the title identifies Nemotron Voice Agent, Astra, and NVIDIA Cloud Functions.
- Confirm that the description shows the actual app, UI, chart, and deployed timestamp.
- Confirm that the Google account email is collected.
- Confirm that the Generic choice skips the Omni section and the Omni choice skips the Generic section.
- Confirm that both branches reach every shared section.
- Confirm that **Session — Session ID** is required.
- Confirm that no form text, prefilled value, or response sheet contains a credential.
- Confirm that the evidence folder complies with the approved access policy.
- Confirm that the linked response sheet is visible only to the evaluation owners.
- Submit and remove one disposable response for each example.

Google documents section navigation in the [Apps Script Forms service reference](https://developers.google.com/apps-script/reference/forms) and form publication in the [Google Forms publication guide](https://developers.google.com/workspace/forms/api/guides/publish-form).
