// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Hindi SQA for the Multilingual Frontend/Backend Assistant, through the real UI.
//
// Session A picks the card's Hindi mode and presses Start and speaks Hindi turns
// that cover every Generic tool, a follow-up, an English question, and a goodbye.
// Session B picks "Any language", picks Hindi in the language picker,
// and checks that path. For every turn the suite verifies that:
//   - the application ASR produced a user transcript with the expected Hindi words;
//   - the expected backend tool fired (or no tool, for conversational turns);
//   - every new bot message, including fillers, is Hindi (Devanagari, no English
//     sentences); and
//   - the bot actually spoke Hindi: its recorded audio is transcribed with a
//     multilingual ASR and must be Devanagari.
// Session IDs are reported so the server log can be checked for the language lock,
// filler candidates, and English tool arguments.
//
//   node hindi_multilingual.mjs            (SQA_IGNORE_CERT=1 for internal TLS)
import fs from "node:fs";
import * as H from "./lib/harness.mjs";
import { transcribeMultilingual } from "./lib/audio.mjs";

const SPEECH = "Speak naturally in Hindi with a native Indian accent, at a normal conversational pace.";
const TURN_GUARD_MS = 120000;

// Latin words a Hindi reply may legitimately contain: brands, units, and symbols.
const ALLOWED_LATIN = /^(nvidia|nvda|nemotron|gemma|super|vl|bmi|ai|gpu|usd|inr|km|kg|cm|c|f|am|pm|ist|utc|ok|nasdaq|london|delhi|mumbai|asr|tts|llm|magpie|nim|api)$/i;

// The Gemma 4 Talker's catalog languages; the picker must not offer anything else.
const TALKER_LANGUAGES = new Set(["en", "de", "es", "fr", "it", "ja", "hi", "ko", "pt", "zh", "ar", "vi"]);

const SESSION_A = [
  { name: "capabilities", text: "नमस्ते, तुम क्या-क्या कर सकते हो?", heard: /नमस्ते|क्या|कर सकते/, tool: null, budgetS: 12 },
  { name: "weather", text: "दिल्ली में आज मौसम कैसा है?", heard: /दिल्ली|मौसम/, tool: "get_weather", want: /\d|डिग्री|तापमान|मौसम/, budgetS: 20 },
  { name: "weather_followup", text: "और मुंबई में?", heard: /मुंबई|मुम्बई/, tool: "get_weather", want: /मुंबई|मुम्बई|\d|डिग्री|तापमान/, budgetS: 20 },
  { name: "stock", text: "ज़रा बताइए, एनवीडिया के शेयर का भाव क्या है?", heard: /शेयर|भाव|एनवीडिया|एन्वीडिया|nvidia/i, tool: "get_stock_price", want: /[0-9०-९]/, budgetS: 20 },
  { name: "time", text: "अभी कितने बजे हैं?", heard: /बजे|समय|कितने/, tool: "get_current_time", want: /\d|बजे|बजकर|समय/, budgetS: 20 },
  { name: "bmi", text: "मेरा वजन सत्तर किलो है और लंबाई एक सौ पचहत्तर सेंटीमीटर है, मेरा बीएमआई बताओ।", heard: /वजन|किलो|बीएमआई|लंबाई/, tool: "calculate_bmi", want: /\d|बीएमआई|bmi/i, budgetS: 20 },
  { name: "random", text: "एक से सौ के बीच कोई भी एक संख्या चुनो।", heard: /संख्या|सौ|चुनो/, tool: "generate_random_number", want: /\d|संख्या/, budgetS: 20 },
  { name: "web_search", text: "भारत में आज की कोई एक बड़ी खबर बताओ।", heard: /खबर|भारत/, tool: "web_search", want: null, budgetS: 30 },
  { name: "architecture", text: "मुझे इस एजेंट का आर्किटेक्चर दिखाओ।", heard: /आर्किटेक्चर|दिखाओ|एजेंट/, tool: "show_architecture", want: null, budgetS: 20 },
  // With the default locked ASR (FRONTEND_BACKEND_FIXED_LANGUAGE_ASR=locked) English speech
  // is not transcribed, so silence is expected; if it is transcribed, the reply must be Hindi.
  { name: "english_input", text: "What's the weather in London right now?", heard: /weather|london|लंदन/i, tool: "get_weather", want: /लंदन|london|\d|डिग्री|तापमान/i, budgetS: 20, speech: "Speak in natural American English.", optionalInput: true },
  { name: "goodbye", text: "बहुत धन्यवाद, अब मैं चलता हूँ।", heard: /धन्यवाद|चलता/, tool: null, budgetS: 12 },
];

const SESSION_B = [
  { name: "greeting", text: "नमस्ते, आप कौन हैं?", heard: /नमस्ते|कौन/, tool: null, budgetS: 12 },
  { name: "weather", text: "जयपुर में मौसम कैसा है?", heard: /जयपुर|मौसम/, tool: "get_weather", want: /\d|डिग्री|तापमान|जयपुर/, budgetS: 20 },
];

function hindiCheck(text) {
  const letters = [...String(text)].filter((ch) => /\p{L}/u.test(ch));
  const devanagari = letters.filter((ch) => /[ऀ-ॿ]/.test(ch)).length;
  const ratio = letters.length ? devanagari / letters.length : 0;
  const latinWords = (String(text).match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).filter((w) => !ALLOWED_LATIN.test(w));
  return { ratio: Number(ratio.toFixed(2)), latinWords, ok: letters.length > 0 && ratio >= 0.6 && latinWords.length <= 2 };
}

const guard = (label, ms, fn) => Promise.race([
  fn(),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms)),
]);

async function openLanding(page) {
  await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (!(await H.waitForDeploymentReady(page, { timeoutMs: 45000 }))) throw new Error("deployment options did not become ready");
  const skipTour = page.getByRole("button", { name: /skip tour/i });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
  const card = page.locator(".example-card").filter({ hasText: /multilingual/i }).first();
  await card.waitFor({ timeout: 30000 });
  return card;
}

async function confirmWithoutCapture(page) {
  const consent = page.getByRole("dialog", { name: "Help improve the conversation?", exact: true });
  await consent.waitFor({ timeout: 15000 });
  await consent.getByRole("button", { name: "Continue without saving", exact: true }).click();
}

async function waitConnected(page, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (/connected|listening|speaking|thinking/i.test(await H.orbCaption(page))) return Date.now() - t0;
    await H.sleep(500);
  }
  return null;
}

async function launchHindiAssistant(page) {
  const card = await openLanding(page);
  // Picking the Hindi mode only selects it; the single Start button begins the session.
  await card.getByRole("radio", { name: /hindi/i }).click();
  await page.getByRole("button", { name: /^start in hindi$/i }).click();
  await confirmWithoutCapture(page);
}

async function launchAnyLanguageInHindi(page, rep) {
  const card = await openLanding(page);
  await card.getByRole("radio", { name: /any language/i }).click();
  const picker = page.locator(".startview__language select");
  await picker.waitFor({ timeout: 10000 });
  // The list loads from /api/tts-config after the picker appears.
  let values = [];
  for (let waited = 0; waited < 15000 && values.length <= 1; waited += 500) {
    values = await picker.locator("option").evaluateAll((options) => options.map((o) => o.value));
    if (values.length <= 1) await H.sleep(500);
  }
  rep.pickerLanguages = values;
  const unsupported = values.filter((code) => !TALKER_LANGUAGES.has(code.split("-")[0]));
  if (unsupported.length) rep.hardFails.push(`language picker offers languages the Gemma 4 Talker does not speak: ${unsupported.join(", ")}`);
  if (!values.includes("hi-IN")) throw new Error(`language picker does not offer hi-IN (offers ${values.join(", ")})`);
  await picker.selectOption("hi-IN");
  rep.launchBarText = await page.locator(".startview__selection strong").innerText().catch(() => "");
  await page.getByRole("button", { name: /^start conversation$/i }).click();
  await confirmWithoutCapture(page);
}

async function runSession(key, label, slotIndex, launch, turns) {
  const sig = H.newSignals();
  const rep = { key, label, startedAt: new Date().toISOString(), turns: [], hardFails: [], warns: [] };
  const slot = await H.createAudioSlot(slotIndex);
  const extraArgs = process.env.SQA_IGNORE_CERT ? ["--ignore-certificate-errors"] : [];
  const browser = await H.launchBrowser({ headless: false, env: slot.env, extraArgs });
  try {
    const { page } = await H.newPage(browser, sig, { timezoneId: "Asia/Kolkata" });
    await launch(page, rep);
    rep.connectMs = await waitConnected(page);
    if (rep.connectMs == null) { rep.hardFails.push("never connected"); return finish(rep, sig, browser); }
    rep.sessionId = await H.sessionId(page);
    await H.installToolWatch(page);
    if (!(await H.waitForSettledWelcome(page))) rep.hardFails.push("welcome did not settle");
    const welcome = (await H.readMessages(page)).filter((m) => m.role === "bot").map((m) => m.text).join(" ");
    rep.welcome = { text: welcome, ...hindiCheck(welcome) };
    if (!rep.welcome.ok) rep.hardFails.push(`welcome not Hindi: "${welcome.slice(0, 80)}"`);

    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      process.stdout.write(`    ${key} turn ${i + 1}/${turns.length} [${t.name}] `);
      const mark = await H.toolWatchMark(page);
      const before = (await H.readMessages(page)).length;
      let r;
      try {
        r = await guard(`${key}_${t.name}`, TURN_GUARD_MS, () => H.turn(page, t.text, `${key}_${i + 1}_${t.name}`, {
          micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor, settle: true,
          transcribeBot: false, speechInstructions: t.speech || SPEECH,
        }));
      } catch (error) {
        rep.hardFails.push(`turn ${i + 1} ${t.name}: ${String(error.message || error).slice(0, 120)}`);
        console.log("ERROR");
        continue;
      }
      const fired = await H.toolWatchSince(page, mark);
      const botMessages = (await H.readMessages(page)).slice(before).filter((m) => m.role === "bot" && m.text);
      const answer = botMessages.at(-1)?.text || "";
      const perMessage = botMessages.map((m) => ({ text: m.text, ...hindiCheck(m.text) }));
      let audioAsr = "", audioAsrError = "";
      if (r.botSpoke) {
        try { audioAsr = await transcribeMultilingual(r.wav, { language: "hi" }); }
        catch (error) { audioAsrError = String(error.message || error).slice(0, 160); }
      }
      const audio = hindiCheck(audioAsr);
      const tr = {
        i: i + 1, name: t.name, user: t.text, domUser: r.domUser, inputReceived: r.inputReceived,
        heardOk: t.heard.test(r.domUser || ""), expectedTool: t.tool, fired,
        toolOk: t.tool ? fired.includes(t.tool) : fired.length === 0,
        botSpoke: r.botSpoke, answer, answerOk: t.want ? t.want.test(answer) : true,
        botMessages: perMessage, hindiOk: perMessage.length > 0 && perMessage.every((m) => m.ok),
        audioAsr, audioAsrError, audioHindiOk: audio.ok, audioRatio: audio.ratio,
        latencyS: r.latencyS ?? null,
      };
      rep.turns.push(tr);
      const tag = `turn ${i + 1} ${t.name}`;
      if (t.optionalInput && !tr.inputReceived) {
        tr.skipped = true;
        rep.warns.push(`${tag}: not transcribed (expected with the locked session-language ASR)`);
        console.log("not transcribed (expected)");
        continue;
      }
      if (!tr.inputReceived) rep.hardFails.push(`${tag}: no application user transcript`);
      else if (!tr.heardOk) rep.hardFails.push(`${tag}: app ASR heard "${(r.domUser || "").slice(0, 60)}"`);
      if (!tr.toolOk) rep.hardFails.push(`${tag}: expected tool ${t.tool || "none"}, fired [${fired.join(", ")}]`);
      if (!tr.botSpoke) rep.hardFails.push(`${tag}: bot did not speak`);
      if (!tr.hindiOk) {
        const bad = perMessage.find((m) => !m.ok);
        rep.hardFails.push(`${tag}: non-Hindi bot text "${(bad?.text || "(none)").slice(0, 80)}"`);
      }
      if (tr.botSpoke && !audioAsrError && !tr.audioHindiOk) rep.hardFails.push(`${tag}: bot audio not Hindi: "${audioAsr.slice(0, 80)}"`);
      if (audioAsrError) rep.warns.push(`${tag}: bot audio ASR failed: ${audioAsrError}`);
      if (!tr.answerOk) rep.warns.push(`${tag}: answer did not match /${t.want.source}/: "${answer.slice(0, 80)}"`);
      if (tr.latencyS != null && tr.latencyS > t.budgetS) rep.warns.push(`${tag}: latency ${tr.latencyS}s > ${t.budgetS}s`);
      console.log(`${tr.botSpoke ? "spoke" : "SILENT"} tool=[${fired.join(",")}] hindi=${tr.hindiOk && tr.audioHindiOk ? "yes" : "NO"} lat=${tr.latencyS ?? "?"}s | ${answer.slice(0, 50)}`);
    }

    const end = await H.endConversation(page);
    rep.ended = end.ended;
  } catch (error) {
    rep.hardFails.push(`threw: ${String(error.message || error).slice(0, 200)}`);
  }
  return finish(rep, sig, browser);
}

async function finish(rep, sig, browser) {
  await browser.close().catch(() => {});
  const errors = sig.consoleErrors.filter((e) => !/favicon/i.test(e));
  if (errors.length) rep.warns.push(`${errors.length} console error(s): ${errors[0].slice(0, 100)}`);
  if (sig.badResponses.length) rep.hardFails.push(`${sig.badResponses.length} HTTP>=400: ${sig.badResponses[0]}`);
  if (sig.wsClosures.length) rep.hardFails.push(`bad WS close: ${sig.wsClosures[0]}`);
  rep.pass = rep.hardFails.length === 0;
  rep.finishedAt = new Date().toISOString();
  return rep;
}

(async () => {
  const out = { runId: H.RUN_ID, base: H.BASE, startedAt: new Date().toISOString(), sessions: [] };
  const plans = [
    ["A", "Hindi mode + Start", 91, launchHindiAssistant, SESSION_A],
    ["B", "Any language with Hindi picked", 92, launchAnyLanguageInHindi, SESSION_B],
  ];
  for (const [key, label, slot, launch, turns] of plans) {
    console.log(`\n===== SESSION ${key}: ${label} =====`);
    const rep = await runSession(key, label, slot, launch, turns);
    out.sessions.push(rep);
    console.log(`  => ${rep.pass ? "PASS" : "FAIL"} session=${rep.sessionId || "?"} ${rep.hardFails.length ? "| HARD: " + rep.hardFails.join(" | ") : ""}`);
    if (rep.warns.length) console.log(`     warns: ${rep.warns.join(" | ")}`);
  }
  fs.mkdirSync(H.OUT, { recursive: true });
  fs.writeFileSync(`${H.OUT}/hindi_report.json`, JSON.stringify(out, null, 2));
  const turns = out.sessions.flatMap((s) => s.turns);
  const passedTurns = turns.filter((t) => t.skipped || (t.inputReceived && t.heardOk && t.toolOk && t.botSpoke && t.hindiOk && (t.audioHindiOk || t.audioAsrError))).length;
  console.log(`\n===== ${out.sessions.filter((s) => s.pass).length}/${out.sessions.length} sessions, ${passedTurns}/${turns.length} turns passed =====`);
  console.log(`  sessions: ${out.sessions.map((s) => `${s.key}=${s.sessionId || "?"}`).join(" ")}  report: hindi_report.json`);
  process.exit(out.sessions.every((s) => s.pass) ? 0 : 1);
})();
