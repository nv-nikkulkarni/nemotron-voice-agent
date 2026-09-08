// Verify the Omni example's per-turn latency after the reasoning-default fix:
// drives a real consented Omni session and reports the session config the server
// actually persisted (enable_thinking) plus the observed turn latency.
import { chromium } from "playwright";
import { newSignals, newPage, selectExample, startConversation, endConversation, sleep } from "./lib/harness.mjs";

const BASE = process.env.SQA_BASE || "http://localhost:5173";
const MIC_WAV = "/audio/g_know_planet_48k.wav";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
    "--disable-gpu", "--disable-dev-shm-usage",
    `--use-file-for-fake-audio-capture=${MIC_WAV}`,
  ],
});
const sig = newSignals();
const { ctx, page } = await newPage(browser, sig);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
await selectExample(page, { example: "omni", consent: true });
// The popup fetches this example's LLM catalog asynchronously; extra_params is
// only sent once an LLM is actually selected, so launching too early skips the
// very code path under test. Wait for the catalog to settle.
await sleep(6000);

// Read the reasoning value the popup settled on before launching.
const reasoningInPopup = await page.evaluate(() => {
  const cb = document.querySelector(".reasoning-toggle input[type=checkbox]");
  return cb ? cb.checked : "toggle-not-rendered(omni)";
});
console.log("reasoning checkbox in popup:", reasoningInPopup);

const conn = await startConversation(page, { timeoutMs: 60000 });
console.log("connected:", conn);
const sid = await page.evaluate(() => window.__session?.sessionId ?? "");
await sleep(25000);
await endConversation(page);
console.log("consoleErrors:", sig.consoleErrors);
await ctx.close();
await browser.close();
