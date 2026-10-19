// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// ASR experiment: does silence around an utterance change how often the app's ASR transcribes it correctly?
// Each utterance is synthesised once, then played into a live Any-language session in three variants:
//   base   the audio as synthesised
//   lead   500 ms of silence before the speech
//   both   500 ms before and 1000 ms after
// Every variant is repeated, and the app's own transcript is compared with the expected words.
//
//   node asr_variants.mjs [reps]        (SQA_IGNORE_CERT=1 for internal TLS)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as H from "./lib/harness.mjs";
import { synthSpeech, to16kMonoWav } from "./lib/audio.mjs";

const REPS = Number(process.argv[2] || 3);
const PLAN = [
  { code: "es", speech: "Speak naturally in Spanish at a normal conversational pace.", utterances: [
    { name: "stock", text: "¿Cuál es el precio de las acciones de NVIDIA?", heard: /nvidia|envidia|acciones|precio/i, tool: /acciones|precio/i },
    { name: "time", text: "¿Qué hora es en Tokio?", heard: /hora|tokio/i } ] },
  { code: "fr", speech: "Speak naturally in French at a normal conversational pace.", utterances: [
    { name: "time", text: "Quelle heure est-il à Tokyo ?", heard: /heure|tokyo/i },
    { name: "weather", text: "Quel temps fait-il à Paris ?", heard: /temps|paris/i } ] },
  { code: "ja", speech: "Speak naturally in Japanese at a normal conversational pace.", utterances: [
    { name: "stock", text: "NVIDIAの株価はいくらですか？", heard: /株価|nvidia|エヌビディア/i },
    { name: "weather", text: "東京の天気はどうですか？", heard: /東京|天気/ } ] },
];

function variant(src, dst, leadMs, trailMs) {
  const filters = [];
  if (leadMs) filters.push(`adelay=${leadMs}|${leadMs}`);
  if (trailMs) filters.push(`apad=pad_dur=${trailMs / 1000}`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, ...(filters.length ? ["-af", filters.join(",")] : []), "-ar", "16000", "-ac", "1", dst]);
  return dst;
}

async function waitConnected(page, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (/connected|listening|speaking|thinking/i.test(await H.orbCaption(page))) return true;
    await H.sleep(500);
  }
  return false;
}

async function launch(page, code) {
  await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await H.waitForDeploymentReady(page, { timeoutMs: 45000 });
  const skipTour = page.getByRole("button", { name: /skip tour/i });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
  const card = page.locator(".example-card").filter({ hasText: /multilingual/i }).first();
  await card.getByRole("radio", { name: /any language/i }).click();
  const picker = page.locator(".startview__language select");
  await picker.waitFor({ timeout: 10000 });
  let values = [];
  for (let w = 0; w < 15000 && values.length <= 1; w += 500) { values = await picker.locator("option").evaluateAll((o) => o.map((x) => x.value)); if (values.length <= 1) await H.sleep(500); }
  await picker.selectOption(values.find((v) => v.toLowerCase().startsWith(code)));
  await page.getByRole("button", { name: /^start conversation$/i }).click();
  const consent = page.getByRole("dialog", { name: "Help improve the conversation?", exact: true });
  await consent.waitFor({ timeout: 15000 });
  await consent.getByRole("button", { name: "Continue without saving", exact: true }).click();
}

(async () => {
  const results = [];
  let slotIndex = 94;
  for (const lang of PLAN) {
    const sig = H.newSignals();
    const slot = await H.createAudioSlot(slotIndex++);
    const browser = await H.launchBrowser({ headless: false, env: slot.env, extraArgs: process.env.SQA_IGNORE_CERT ? ["--ignore-certificate-errors"] : [] });
    console.log(`\n===== ${lang.code} =====`);
    try {
      const { page } = await H.newPage(browser, sig, {});
      await launch(page, lang.code);
      if (!(await waitConnected(page))) { console.log("  never connected"); continue; }
      await H.installToolWatch(page);
      await H.waitForSettledWelcome(page);
      for (const u of lang.utterances) {
        const base = (await synthSpeech(u.text, `${H.OUT}/asrv_${lang.code}_${u.name}.wav`, { instructions: lang.speech })).outWav;
        const wavs = {
          base: variant(base, `${H.OUT}/asrv_${lang.code}_${u.name}_base.wav`, 0, 0),
          lead: variant(base, `${H.OUT}/asrv_${lang.code}_${u.name}_lead.wav`, 500, 0),
          both: variant(base, `${H.OUT}/asrv_${lang.code}_${u.name}_both.wav`, 500, 1000),
        };
        for (const [vname, wav] of Object.entries(wavs)) {
          for (let rep = 0; rep < REPS; rep++) {
            let r;
            try {
              r = await Promise.race([
                H.turn(page, u.text, `asrv_${lang.code}_${u.name}_${vname}_${rep}`, { micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor, settle: true, transcribeBot: false, inputWav: wav }),
                new Promise((_, rej) => setTimeout(() => rej(new Error("turn timeout")), 120000)),
              ]);
            } catch (error) { console.log(`  ${lang.code} ${u.name} ${vname}#${rep}: ERROR ${error.message}`); results.push({ lang: lang.code, utt: u.name, variant: vname, rep, got: "", received: false, ok: false, error: true }); continue; }
            const got = r.domUser || "";
            const ok = Boolean(r.inputReceived) && u.heard.test(got);
            results.push({ lang: lang.code, utt: u.name, variant: vname, rep, got, received: Boolean(r.inputReceived), ok });
            console.log(`  ${lang.code} ${u.name} ${vname}#${rep}: ${ok ? "OK  " : "MISS"} "${got.slice(0, 60)}"`);
          }
        }
      }
      await H.endConversation(page);
    } catch (error) { console.log(`  threw: ${String(error.message || error).slice(0, 160)}`); }
    await browser.close().catch(() => {});
  }
  fs.writeFileSync(`${H.OUT}/asr_variants_report.json`, JSON.stringify(results, null, 2));
  console.log("\n===== summary: correct transcripts per variant =====");
  for (const v of ["base", "lead", "both"]) {
    const rows = results.filter((x) => x.variant === v);
    const dropped = rows.filter((x) => !x.received).length;
    console.log(`  ${v.padEnd(5)} ${rows.filter((x) => x.ok).length}/${rows.length} correct, ${dropped} with no transcript`);
  }
  for (const code of ["es", "fr", "ja"]) for (const v of ["base", "lead", "both"]) {
    const rows = results.filter((x) => x.lang === code && x.variant === v);
    console.log(`    ${code} ${v.padEnd(5)} ${rows.filter((x) => x.ok).length}/${rows.length}`);
  }
})();
