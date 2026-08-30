// Speaks the exact phrasings that hallucinated in session ef19bd90fcc7 and prints
// the session id so we can check the app log for web_search calls per turn.
import * as H from "./lib/harness.mjs";

const QUESTIONS = [
  "What is the weather in Pune",
  "What is the stock price of NVIDIA",
  "What is the exchange rate of dollar to rupee",
  "What is the current date and time",
];

async function main() {
  const sig = H.newSignals();
  const browser = await H.launchBrowser({ headless: false });
  const { page } = await H.newPage(browser, sig);
  await page.goto(H.BASE, { waitUntil: "domcontentloaded" }); await H.sleep(1400);
  await H.selectExample(page, { example: "generic", model: "super" });
  await H.startConversation(page); await H.sleep(1800);
  const sessionId = await H.sessionId(page);
  const turns = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const r = await H.turn(page, QUESTIONS[i], `grd_t${i + 1}`);
    turns.push({ asked: QUESTIONS[i], heardByApp: r.domUser, answer: (r.botAsr || r.domBot || "").slice(0, 80) });
  }
  console.log(JSON.stringify({ sessionId, turns }, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
