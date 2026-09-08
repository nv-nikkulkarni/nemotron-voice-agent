import { chromium } from "playwright";
import {
  newSignals, newPage, selectExample, startConversation,
  endConversation, dismissFeedback, sleep,
} from "./lib/harness.mjs";

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
await ctx.addInitScript(() => { localStorage.setItem("nvidia-voice-agent-transport", "websocket"); });

const captureReqs = [];
page.on("request", (r) => { if (r.url().includes("/api/session-capture")) captureReqs.push({ url: r.url(), method: r.method(), stage: "request" }); });
page.on("requestfinished", async (r) => {
  if (r.url().includes("/api/session-capture")) {
    const resp = await r.response();
    captureReqs.push({ url: r.url(), stage: "finished", status: resp ? resp.status() : null });
  }
});

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
await selectExample(page, { example: "generic", model: "lightning", consent: true });
const conn = await startConversation(page, { timeoutMs: 40000 });
console.log("connected:", conn);
await sleep(16000);
const end = await endConversation(page);
console.log("ended:", end);
const sessionState = await page.evaluate(() => (window).__session);
console.log("window.__session:", JSON.stringify(sessionState, null, 2));
await sleep(20000); // give a possibly-hung disconnect() extra time to eventually settle
console.log("captureReqs after 20s wait:", JSON.stringify(captureReqs, null, 2));
await dismissFeedback(page);

console.log("captureReqs:", JSON.stringify(captureReqs, null, 2));
console.log("badResponses:", sig.badResponses);
console.log("failedRequests:", sig.failedRequests);
console.log("consoleErrors:", sig.consoleErrors);

await ctx.close();
await browser.close();
