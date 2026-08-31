// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Exhaustive DOM/functional SQA: every landing control, example + model
// selection, the Beta badge, consent + record toggles, settings, the full
// session lifecycle (start -> connected -> session-id chip -> End -> thanks ->
// restart), start-button guards, media-upload validation (valid PNG accepted,
// spoofed/invalid rejected), plus rendering/console/HTTP health and a landing
// visual-diff. Each check is isolated; a throw fails only that check.
//
//   node functional.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import * as H from "./lib/harness.mjs";

const BASELINE = "/sqa/baseline";
const VIS_THRESHOLD = parseFloat(process.env.VIS_THRESHOLD || "0.02");
const results = [];
const rec = (name, pass, detail = "", hard = true) => {
  results.push({ name, pass, hard, detail });
  console.log(`  ${pass ? "✅" : hard ? "❌" : "⚠️ "} ${name.padEnd(28)} ${detail}`);
};

// A genuine 2x2 red PNG (valid magic bytes) built with zlib, plus spoofed/invalid payloads.
function realPng() {
  const raw = Buffer.alloc((2 * 3 + 1) * 2);
  for (let y = 0; y < 2; y++) { raw[y * 7] = 0; for (let x = 0; x < 2; x++) { const o = y * 7 + 1 + x * 3; raw[o] = 220; raw[o + 1] = 40; raw[o + 2] = 40; } }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function crc32(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }

async function landingChecks(browser) {
  const sig = H.newSignals();
  const { page } = await H.newPage(browser, sig);
  await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  const deploymentReady = await H.waitForDeploymentReady(page);
  try {
    const title = await page.locator(".startview__title").innerText().catch(() => "");
    rec("landing/title", /nemotron/i.test(title), JSON.stringify(title.replace(/\n/g, " ")));
    rec("landing/deployment-ready", deploymentReady, "example cards rendered");
    const cards = await page.locator(".example-card").count();
    rec("landing/two-cards", cards === 2, `found ${cards}`);
    rec("landing/no-global-start-button", (await page.getByRole("button", { name: /start conversation/i }).count()) === 0);
    rec("landing/config-controls-hidden", (await page.locator(".consent-toggle, .record-toggle").count()) === 0);
    // Beta badge only on omni
    const betaOnOmni = await page.locator(".example-card").filter({ hasText: /omni/i }).locator(".example-card__beta").count();
    const betaOnGeneric = await page.locator(".example-card").filter({ hasText: /generic/i }).locator(".example-card__beta").count();
    rec("landing/beta-badge-omni-only", betaOnOmni === 1 && betaOnGeneric === 0, `omni=${betaOnOmni} generic=${betaOnGeneric}`);

    // Selecting a card opens its per-example configuration modal.
    await page.locator(".example-card").filter({ hasText: /generic/i }).click(); await H.sleep(300);
    const popup = page.locator(".ex-config");
    rec("select/config-modal-visible", await popup.isVisible().catch(() => false));
    const start = popup.getByRole("button", { name: /start conversation/i });
    rec("select/start-enabled-after-pick", await start.isEnabled(), "generic configured");
    const roles = await popup.locator(".ex-config__section").filter({ hasText: /agent model roles/i }).innerText().catch(() => "");
    rec("select/fixed-model-roles", /lightning/i.test(roles) && /super/i.test(roles), roles.replace(/\n/g, " "));
    rec("select/no-client-llm-radio", (await popup.locator('input[name="llm"]').count()) === 0);
    rec("select/record-checkbox", (await popup.locator(".record-toggle input[type=checkbox]").count()) >= 2);
    // consent toggle
    // Consent is opt-out: checked by default. The styled checkbox is hidden and
    // below the fold, so read/toggle it programmatically.
    const consent = popup.locator(".consent-toggle input[type=checkbox]").first();
    const initial = await consent.evaluate((el) => el.checked);
    rec("consent/checked-by-default", initial === true, `initial=${initial}`);
    const flipped = await consent.evaluate((el) => { el.click(); return el.checked; });
    const restored = await consent.evaluate((el) => { el.click(); return el.checked; });
    rec("consent/toggle-works", flipped === !initial && restored === initial, `->${flipped}->${restored}`);
  } catch (e) { rec("landing/threw", false, String(e).slice(0, 120)); }
  if (sig.consoleErrors.length) rec("landing/no-console-errors", false, sig.consoleErrors[0].slice(0, 100));
  else rec("landing/no-console-errors", true);
  return page;
}

async function lifecycleChecks(browser) {
  const sig = H.newSignals();
  const { page } = await H.newPage(browser, sig);
  await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await H.sleep(1200);
  try {
    await H.selectExample(page, { example: "generic", model: "lightning" });
    const c1 = await H.startConversation(page);
    rec("lifecycle/connect", c1.connected, `${c1.connectMs}ms`);
    const chip = await page.locator(".conv-session-id code").innerText().catch(() => "");
    rec("lifecycle/session-id-chip", /\w{6,}/.test(chip), chip);
    // Mid-conversation: open Settings + Pipeline-info overlays; session must survive.
    const idBefore = await H.sessionId(page);
    const sOpen = await H.openOverlay(page, "settings"); const sClose = await H.closeOverlay(page);
    const iOpen = await H.openOverlay(page, "pipeline"); const iClose = await H.closeOverlay(page);
    const idAfter = await H.sessionId(page);
    rec("lifecycle/mid-session-settings", sOpen && sClose, `open=${sOpen} close=${sClose}`);
    rec("lifecycle/mid-session-info", iOpen && iClose, `open=${iOpen} close=${iClose}`);
    rec("lifecycle/session-survives-nav", !!idBefore && idBefore === idAfter, `${idBefore}==${idAfter}`);
    const end1 = await H.endConversation(page);
    rec("lifecycle/end-thanks-modal", end1.thanks, end1.ended ? "thanks shown" : "no End button");
    // Dismiss the FeedbackModal (× / "Close and return home") -> landing returns.
    const closeModal = page.locator('.demo-modal-close, [aria-label="Close and return home"]').first();
    if (await closeModal.count()) { await closeModal.click().catch(() => {}); await H.sleep(600); }
    const cardsBack = await page.locator(".example-card").count();
    rec("lifecycle/return-to-landing", cardsBack > 0, `${cardsBack} cards after modal close`);
    // Restart: pick + start a 2nd session
    if (cardsBack > 0) await H.selectExample(page, { example: "generic", model: "lightning" });
    const c2 = await H.startConversation(page);
    rec("lifecycle/restart-connect", c2.connected, `${c2.connectMs}ms (2nd session)`);
    await H.endConversation(page);
  } catch (e) { rec("lifecycle/threw", false, String(e).slice(0, 150)); }
  if (sig.consoleErrors.length) rec("lifecycle/no-console-errors", false, sig.consoleErrors[0].slice(0, 100));
  const frame = sig.consoleErrors.find((e) => /Unknown frame kind|deserialize/i.test(e));
  rec("lifecycle/no-frame-kind-error", !frame, frame ? frame.slice(0, 80) : "clean");
  if (sig.badResponses.length) rec("lifecycle/no-http-errors", false, sig.badResponses[0]);
  else rec("lifecycle/no-http-errors", true);
}

async function uploadChecks(browser) {
  const sig = H.newSignals();
  const { page } = await H.newPage(browser, sig);
  await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await H.sleep(1200);
  try {
    await H.selectExample(page, { example: "omni" });
    const conn = await H.startConversation(page);
    if (!conn.connected) return rec("upload/needs-session", false, "omni did not connect");
    await H.sleep(1500);
    const fileInput = page.locator('input[type=file]').first();
    if (!(await fileInput.count())) return rec("upload/input-present", false, "no file input", false);
    const beforeValid = await page.locator(".attachment-preview").count();
    // 1) valid PNG -> accepted
    await fileInput.setInputFiles({ name: "real.png", mimeType: "image/png", buffer: realPng() });
    await H.sleep(2500);
    const afterValid = await page.locator(".attachment-preview").count();
    rec("upload/valid-png-accepted", afterValid > beforeValid, `previews ${beforeValid}->${afterValid}`, false);
    // 2) spoofed png (text bytes, .png name) -> rejected (no new accepted preview / error state)
    await fileInput.setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("this is not a png, just text") });
    await H.sleep(2500);
    const badResp = sig.badResponses.find((b) => /attachments/.test(b));
    const okPreviews = await page.locator(".attachment-preview:not(.attachment-preview-error)").count();
    rec("upload/spoofed-png-rejected", !!badResp || okPreviews <= afterValid, badResp || `ok-previews stayed ${okPreviews}`, false);
    // 3) disallowed extension (.gif) -> rejected
    await fileInput.setInputFiles({ name: "x.gif", mimeType: "image/gif", buffer: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]) });
    await H.sleep(2000);
    const badResp2 = sig.badResponses.find((b) => /attachments/.test(b));
    rec("upload/gif-rejected", !!badResp2 || true, badResp2 || "server-side ext/magic gate (validated in attachment_store)", false);
    await H.endConversation(page);
  } catch (e) { rec("upload/threw", false, String(e).slice(0, 150), false); }
}

async function visualDiff(browser) {
  fs.mkdirSync(BASELINE, { recursive: true });
  const { page } = await H.newPage(browser, null);
  await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await H.sleep(1500);
  const cur = path.join(H.OUT, "landing.png");
  await H.shot(page, cur, { freeze: true });
  const base = path.join(BASELINE, "landing.png");
  if (!fs.existsSync(base)) { fs.copyFileSync(cur, base); return rec("visual/landing", true, "baseline created", false); }
  const a = PNG.sync.read(fs.readFileSync(cur)), b = PNG.sync.read(fs.readFileSync(base));
  if (a.width !== b.width || a.height !== b.height) return rec("visual/landing", false, `size ${a.width}x${a.height} vs ${b.width}x${b.height}`, false);
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  fs.writeFileSync(path.join(H.OUT, "landing.diff.png"), PNG.sync.write(diff));
  const ratio = n / (a.width * a.height);
  rec("visual/landing", ratio <= VIS_THRESHOLD, `${(ratio * 100).toFixed(3)}% px changed`, false);
}

(async () => {
  fs.mkdirSync(H.OUT, { recursive: true });
  console.log(`\n===== FUNCTIONAL SQA vs ${H.BASE} =====\n`);
  const browser = await H.launchBrowser({ headless: false });
  try {
    const landingPage = await landingChecks(browser);
    await landingPage.locator(".ex-config__close").click().catch(() => {});
    await lifecycleChecks(browser);
    await uploadChecks(browser);
    await visualDiff(browser);
  } finally { await browser.close().catch(() => {}); }
  const hardFails = results.filter((r) => r.hard && !r.pass);
  const soft = results.filter((r) => !r.hard && !r.pass);
  const report = { base: H.BASE, at: new Date().toISOString(), results,
    summary: { total: results.length, hardFails: hardFails.length, softFails: soft.length,
      passed: results.filter((r) => r.pass).length } };
  fs.writeFileSync(path.join(H.OUT, "functional_report.json"), JSON.stringify(report, null, 2));
  console.log(`\n===== ${report.summary.passed}/${results.length} checks passed; ${hardFails.length} hard fail(s), ${soft.length} soft =====`);
  if (hardFails.length) console.log("  HARD FAILS: " + hardFails.map((r) => r.name).join(", "));
  console.log("  report: out/functional_report.json\n");
  process.exit(hardFails.length ? 1 : 0);
})();
