// Check the Reasoning toggle renders for both examples and follows each catalog
// default (Lightning ON for tool reliability; Omni OFF for latency).
import { chromium } from "playwright";
import { newSignals, newPage, sleep } from "./lib/harness.mjs";

const BASE = process.env.SQA_BASE || "http://localhost:5173";

async function check(exampleRe, label) {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const sig = newSignals();
  const { ctx, page } = await newPage(browser, sig);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  const card = page.locator(".example-card").filter({ hasText: exampleRe }).first();
  await card.click();
  await page.locator(".ex-config").waitFor({ state: "visible", timeout: 8000 });
  await sleep(6000); // let the LLM catalog load so the reset effect runs

  const read = () => page.evaluate(() => {
    const cb = document.querySelector(".reasoning-toggle input[type=checkbox]");
    const warn = document.querySelector(".reasoning-warn");
    return { rendered: !!cb, checked: cb ? cb.checked : null, warning: warn ? warn.textContent.trim() : null };
  });

  const before = await read();
  // enable it and re-read
  await page.locator(".reasoning-toggle input[type=checkbox]").evaluate((el) => el.click()).catch(() => {});
  await sleep(400);
  const after = await read();

  console.log(`\n--- ${label} ---`);
  console.log("  default :", JSON.stringify(before));
  console.log("  enabled :", JSON.stringify(after));
  console.log("  consoleErrors:", sig.consoleErrors.length ? sig.consoleErrors : "none");
  await ctx.close();
  await browser.close();
}

await check(/generic/i, "Generic Assistant");
await check(/omni/i, "Omni Assistant");
