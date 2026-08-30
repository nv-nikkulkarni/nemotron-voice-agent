// P7 cluster validation: drive N real consented conversations through astra_client
// (the UI that actually POSTs /api/session-capture) against the k8s Service in
// front of 5 app replicas. Reuses tests/sqa/lib/harness.mjs's proven selectors;
// swaps live-TTS speaking for a pre-recorded fake-mic WAV (no SQA_KEY needed).
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import {
  newSignals, attachSignals, newPage, selectExample, startConversation,
  endConversation, dismissFeedback, installToolWatch, toolWatchMark, toolWatchSince, sessionCaptureStatus, sessionId, waitListening, sleep,
  readMessages,
} from "./lib/harness.mjs";

const BASE = process.env.SQA_BASE || "http://localhost:5173";
const MIC_WAV = process.env.MIC_WAV || fileURLToPath(new URL("./audio/g_know_planet_48k.wav", import.meta.url));
const N = Number(process.env.N || 6);
const WAIT_MS = Number(process.env.WAIT_MS || 16000);
const TTS = process.env.TTS || undefined; // "magpie" | "chatterbox"; unset = popup default
const REASONING = process.env.REASONING == null ? undefined
  : /^(1|true|on)$/i.test(process.env.REASONING);
const EXPECT_TOOL = process.env.EXPECT_TOOL || "";
const FORCE_TOOL = process.env.FORCE_TOOL || "";
const EXPECT_RESULT = process.env.EXPECT_RESULT || "";
const TOOL_LABELS = process.env.TOOLS == null
  ? undefined
  : process.env.TOOLS.split(",").map((name) => name.trim()).filter(Boolean);
const normalizeTool = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, "");

function matchesExpectedResult(messages) {
  if (!EXPECT_RESULT) return true;
  try {
    const pattern = new RegExp(EXPECT_RESULT, "i");
    const botMessages = messages.filter((message) => message.role === "bot");
    return botMessages.length > 0 && pattern.test(botMessages[botMessages.length - 1].text);
  } catch (error) {
    throw new Error("invalid EXPECT_RESULT regex: " + error);
  }
}

function reasoningFromConfig(body) {
  try {
    const parsed = JSON.parse(body.extra_params || "{}");
    const value = parsed?.extra_body?.chat_template_kwargs?.enable_thinking;
    return typeof value === "boolean" ? value : null;
  } catch {
    return null;
  }
}

async function runOne(i) {
  const launchedAt = Date.now();
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--no-sandbox", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
      "--disable-gpu", "--disable-dev-shm-usage",
      `--use-file-for-fake-audio-capture=${MIC_WAV}`,
    ],
  });
  const sig = newSignals();
  const { ctx, page } = await newPage(browser, sig);
  let sentConfig = null;
  try {
    // Capture the exact safe session settings sent by the UI. FORCE_TOOL is a
    // test-only override through the existing session-config contract.
    await page.route("**/api/session-config", async (route) => {
      const request = route.request();
      const body = request.postDataJSON();
      if (FORCE_TOOL) {
        body.tool_choice = { type: "function", function: { name: FORCE_TOOL } };
      }
      sentConfig = {
        toolChoice: body.tool_choice || "auto",
        reasoning: reasoningFromConfig(body),
      };
      await route.continue({
        headers: { ...request.headers(), "content-type": "application/json" },
        postData: JSON.stringify(body),
      });
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    await installToolWatch(page);
    const toolMark = await toolWatchMark(page);
    await selectExample(page, {
      example: "generic", model: "lightning", tts: TTS, tools: TOOL_LABELS,
      reasoning: REASONING, consent: true,
    });
    const conn = await startConversation(page, { timeoutMs: 40000 });
    if (!conn.connected) return { i, ok: false, reason: "never connected", consoleErrors: sig.consoleErrors };
    const sid = await sessionId(page);
    const connectedAt = Date.now();
    // Let the fake-mic WAV play through + the pipeline respond (WAV ~3s + lead/trail).
    await sleep(WAIT_MS);
    await waitListening(page, { timeoutMs: 5000 }).catch(() => {});
    const messages = await readMessages(page);
    const end = await endConversation(page);
    await dismissFeedback(page);
    const tools = await toolWatchSince(page, toolMark);
    const toolMatched = !EXPECT_TOOL || tools.some((name) => normalizeTool(name).includes(normalizeTool(EXPECT_TOOL)));
    const resultMatched = matchesExpectedResult(messages);
    const reasoningMatched = REASONING == null || sentConfig?.reasoning === REASONING;
    return {
      i, ok: toolMatched && resultMatched && reasoningMatched, sid, launchedAt, connectedAt, endedAt: Date.now(),
      connectMs: conn.connectMs, ended: end.ended, thanks: end.thanks,
      config: sentConfig, tools, messages,
      reason: !reasoningMatched
        ? "reasoning setting not observed: " + REASONING
        : (!toolMatched
          ? "expected tool not observed: " + EXPECT_TOOL
          : (!resultMatched ? "expected result not observed: " + EXPECT_RESULT : undefined)),
      consoleErrors: sig.consoleErrors,
    };
  } catch (e) {
    return { i, ok: false, reason: String(e).slice(0, 300), consoleErrors: sig.consoleErrors };
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// Launch separate browser processes concurrently. The previous implementation
// awaited runOne() inside a for-loop, which proved cross-pod routing but never
// put two live sessions under load at the same time.
console.log("Launching " + N + " concurrent browser sessions (tool choice: " + (FORCE_TOOL ? "forced " + FORCE_TOOL : "auto") + ")");
const results = await Promise.all(
  Array.from({ length: N }, async (_unused, i) => {
    const result = await runOne(i);
    console.log(JSON.stringify(result));
    return result;
  }),
);

function maxConcurrentSessions(rows) {
  const events = rows
    .filter((row) => row.connectedAt && row.endedAt)
    .flatMap((row) => [[row.connectedAt, 1], [row.endedAt, -1]])
    .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let active = 0;
  let maximum = 0;
  for (const [, delta] of events) {
    active += delta;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

const status = await (async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const { ctx, page } = await newPage(browser, newSignals());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const s = await sessionCaptureStatus(page);
  await ctx.close(); await browser.close();
  return s;
})();

console.log("\n===== FINAL STATUS =====");
console.log(JSON.stringify(status, null, 2));
console.log("\n===== SESSION IDS =====");
for (const r of results) console.log(r.ok ? `${r.sid}  connectMs=${r.connectMs} ended=${r.ended} thanks=${r.thanks}` : `FAILED: ${r.reason}`);

const okCount = results.filter((r) => r.ok).length;
const overlap = maxConcurrentSessions(results);
const requiredOverlap = Number(process.env.MIN_OVERLAP || Math.min(N, 2));
console.log(`\n${okCount}/${N} sessions completed successfully`);
console.log(`maximum simultaneously connected sessions: ${overlap} (required: ${requiredOverlap})`);
process.exit(okCount === N && overlap >= requiredOverlap ? 0 : 1);
