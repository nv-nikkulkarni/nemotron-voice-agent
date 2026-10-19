// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause
//
// Non-Hindi SQA for the Multilingual Frontend/Backend Assistant, through the real UI.
//
// For each language the test picks the card's "Any language" mode, chooses the language in the picker, presses
// Start, and speaks four turns: a no-tool question, weather, stock price and time. For every turn it verifies that
// the application ASR heard the expected words, the expected tool fired, the bot spoke, and the reply (text and
// audio) is in the requested language.
//
//   node multilingual_languages.mjs [es de fr ja]      (SQA_IGNORE_CERT=1 for internal TLS)
import fs from "node:fs";
import * as H from "./lib/harness.mjs";
import { transcribeMultilingual } from "./lib/audio.mjs";

const TURN_GUARD_MS = 120000;

const WORDS = {
  en: "the is are and of to it you your for with that this can what have will",
  es: "el la los las de que en es un una y para con por hoy está son tiempo grados puedo puedes hora en",
  de: "der die das ist und in zu den mit ein eine für auf nicht wetter grad kann ich sie es uhr",
  fr: "le la les de des et est en un une pour avec que qui je il fait degrés peux heure",
};
const toSet = (s) => new Set(s.split(/\s+/));
const SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, toSet(v)]));

/** Does `text` read as language `code`? Latin languages by function-word share, Japanese by script. */
function languageCheck(text, code) {
  const letters = [...String(text)].filter((ch) => /\p{L}/u.test(ch));
  if (code === "ja") {
    const jp = letters.filter((ch) => /[぀-ヿ一-鿿]/.test(ch)).length;
    const ratio = letters.length ? jp / letters.length : 0;
    return { ratio: Number(ratio.toFixed(2)), ok: letters.length > 0 && ratio >= 0.6 };
  }
  const words = (String(text).toLowerCase().match(/[\p{L}']+/gu) || []);
  if (words.length < 3) return { ratio: 0, ok: false };
  const own = words.filter((w) => SETS[code].has(w)).length / words.length;
  const en = words.filter((w) => SETS.en.has(w)).length / words.length;
  return { ratio: Number(own.toFixed(2)), english: Number(en.toFixed(2)), ok: own >= 0.12 && en <= 0.12 };
}

const LANGS = {
  es: {
    label: "Spanish", speech: "Speak naturally in Spanish at a normal conversational pace.",
    turns: [
      { name: "capabilities", text: "Hola, ¿qué puedes hacer?", heard: /hola|qué|puedes|hacer/i, tool: null },
      { name: "weather", text: "¿Qué tiempo hace en Madrid?", heard: /madrid|tiempo/i, tool: "get_weather" },
      { name: "stock", text: "¿Cuál es el precio de las acciones de NVIDIA?", heard: /nvidia|acciones|precio/i, tool: "get_stock_price" },
      { name: "time", text: "¿Qué hora es en Tokio?", heard: /hora|tokio/i, tool: "get_current_time" },
    ],
  },
  de: {
    label: "German", speech: "Speak naturally in German at a normal conversational pace.",
    turns: [
      { name: "capabilities", text: "Hallo, was kannst du alles?", heard: /hallo|was|kannst/i, tool: null },
      { name: "weather", text: "Wie ist das Wetter in Berlin?", heard: /wetter|berlin/i, tool: "get_weather" },
      { name: "stock", text: "Wie hoch ist der Aktienkurs von NVIDIA?", heard: /aktie|kurs|nvidia/i, tool: "get_stock_price" },
      { name: "time", text: "Wie spät ist es in Tokio?", heard: /spät|uhr|tokio/i, tool: "get_current_time" },
    ],
  },
  fr: {
    label: "French", speech: "Speak naturally in French at a normal conversational pace.",
    turns: [
      { name: "capabilities", text: "Bonjour, que peux-tu faire ?", heard: /bonjour|peux|faire/i, tool: null },
      { name: "weather", text: "Quel temps fait-il à Paris ?", heard: /temps|paris/i, tool: "get_weather" },
      { name: "stock", text: "Quel est le cours de l'action NVIDIA ?", heard: /cours|action|nvidia/i, tool: "get_stock_price" },
      { name: "time", text: "Quelle heure est-il à Tokyo ?", heard: /heure|tokyo/i, tool: "get_current_time" },
    ],
  },
  ja: {
    label: "Japanese", speech: "Speak naturally in Japanese at a normal conversational pace.",
    turns: [
      { name: "capabilities", text: "こんにちは、何ができますか？", heard: /こんにちは|何|できます/, tool: null },
      { name: "weather", text: "東京の天気はどうですか？", heard: /東京|天気/, tool: "get_weather" },
      { name: "stock", text: "NVIDIAの株価はいくらですか？", heard: /株価|nvidia|エヌビディア/i, tool: "get_stock_price" },
      { name: "time", text: "東京は今何時ですか？", heard: /何時|時|東京/, tool: "get_current_time" },
    ],
  },
};

const guard = (label, ms, fn) => Promise.race([
  fn(),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms)),
]);

async function waitConnected(page, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (/connected|listening|speaking|thinking/i.test(await H.orbCaption(page))) return Date.now() - t0;
    await H.sleep(500);
  }
  return null;
}

async function launch(page, rep, code) {
  await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (!(await H.waitForDeploymentReady(page, { timeoutMs: 45000 }))) throw new Error("deployment options did not become ready");
  const skipTour = page.getByRole("button", { name: /skip tour/i });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
  const card = page.locator(".example-card").filter({ hasText: /multilingual/i }).first();
  await card.waitFor({ timeout: 30000 });
  await card.getByRole("radio", { name: /any language/i }).click();
  const picker = page.locator(".startview__language select");
  await picker.waitFor({ timeout: 10000 });
  let values = [];
  for (let waited = 0; waited < 15000 && values.length <= 1; waited += 500) {
    values = await picker.locator("option").evaluateAll((options) => options.map((o) => o.value));
    if (values.length <= 1) await H.sleep(500);
  }
  rep.pickerLanguages = values;
  const value = values.find((v) => v.toLowerCase().startsWith(code));
  if (!value) throw new Error(`language picker does not offer ${code} (offers ${values.join(", ")})`);
  await picker.selectOption(value);
  rep.pickedLanguage = value;
  rep.startLabel = await page.locator('[data-tour="start"]').innerText().catch(() => "");
  await page.getByRole("button", { name: /^start conversation$/i }).click();
  const consent = page.getByRole("dialog", { name: "Help improve the conversation?", exact: true });
  await consent.waitFor({ timeout: 15000 });
  await consent.getByRole("button", { name: "Continue without saving", exact: true }).click();
}

async function runLanguage(code, slotIndex) {
  const cfg = LANGS[code];
  const sig = H.newSignals();
  const rep = { key: code, label: cfg.label, startedAt: new Date().toISOString(), turns: [], hardFails: [], warns: [] };
  const slot = await H.createAudioSlot(slotIndex);
  const extraArgs = process.env.SQA_IGNORE_CERT ? ["--ignore-certificate-errors"] : [];
  const browser = await H.launchBrowser({ headless: false, env: slot.env, extraArgs });
  try {
    const { page } = await H.newPage(browser, sig, {});
    await launch(page, rep, code);
    rep.connectMs = await waitConnected(page);
    if (rep.connectMs == null) { rep.hardFails.push("never connected"); return finish(rep, sig, browser); }
    rep.sessionId = await H.sessionId(page);
    await H.installToolWatch(page);
    if (!(await H.waitForSettledWelcome(page))) rep.hardFails.push("welcome did not settle");
    const welcome = (await H.readMessages(page)).filter((m) => m.role === "bot").map((m) => m.text).join(" ");
    rep.welcome = { text: welcome, ...languageCheck(welcome, code) };
    if (!rep.welcome.ok) rep.warns.push(`welcome not clearly ${cfg.label}: "${welcome.slice(0, 80)}"`);

    for (let i = 0; i < cfg.turns.length; i++) {
      const t = cfg.turns[i];
      process.stdout.write(`    ${code} turn ${i + 1}/${cfg.turns.length} [${t.name}] `);
      const mark = await H.toolWatchMark(page);
      const before = (await H.readMessages(page)).length;
      let r;
      try {
        r = await guard(`${code}_${t.name}`, TURN_GUARD_MS, () => H.turn(page, t.text, `${code}_${i + 1}_${t.name}`, {
          micDevice: slot.micSink, spkDevice: slot.spkSink, monitor: slot.spkMonitor, settle: true,
          transcribeBot: false, speechInstructions: cfg.speech,
        }));
      } catch (error) {
        rep.hardFails.push(`turn ${i + 1} ${t.name}: ${String(error.message || error).slice(0, 120)}`);
        console.log("ERROR");
        continue;
      }
      const fired = await H.toolWatchSince(page, mark);
      const botMessages = (await H.readMessages(page)).slice(before).filter((m) => m.role === "bot" && m.text);
      const answer = botMessages.at(-1)?.text || "";
      const text = languageCheck(botMessages.map((m) => m.text).join(" "), code);
      let audioAsr = "", audioAsrError = "";
      if (r.botSpoke) {
        try { audioAsr = await transcribeMultilingual(r.wav, { language: code }); }
        catch (error) { audioAsrError = String(error.message || error).slice(0, 160); }
      }
      const audio = languageCheck(audioAsr, code);
      const tr = {
        i: i + 1, name: t.name, user: t.text, domUser: r.domUser, inputReceived: r.inputReceived,
        heardOk: t.heard.test(r.domUser || ""), expectedTool: t.tool, fired,
        toolOk: t.tool ? fired.includes(t.tool) : fired.length === 0,
        botSpoke: r.botSpoke, answer, textOk: botMessages.length > 0 && text.ok, textRatio: text.ratio,
        audioAsr, audioAsrError, audioOk: audio.ok, audioRatio: audio.ratio, latencyS: r.latencyS ?? null,
      };
      rep.turns.push(tr);
      const tag = `turn ${i + 1} ${t.name}`;
      if (!tr.inputReceived) rep.hardFails.push(`${tag}: no application user transcript`);
      else if (!tr.heardOk) rep.hardFails.push(`${tag}: app ASR heard "${(r.domUser || "").slice(0, 60)}"`);
      if (!tr.toolOk) rep.hardFails.push(`${tag}: expected tool ${t.tool || "none"}, fired [${fired.join(", ")}]`);
      if (!tr.botSpoke) rep.hardFails.push(`${tag}: bot did not speak`);
      else if (!tr.textOk) rep.hardFails.push(`${tag}: bot text not ${cfg.label}: "${answer.slice(0, 80)}"`);
      if (tr.botSpoke && !audioAsrError && !tr.audioOk) rep.warns.push(`${tag}: bot audio not clearly ${cfg.label}: "${audioAsr.slice(0, 80)}"`);
      if (audioAsrError) rep.warns.push(`${tag}: bot audio ASR failed: ${audioAsrError}`);
      console.log(`${tr.botSpoke ? "spoke" : "SILENT"} tool=[${fired.join(",")}] lang=${tr.textOk ? "yes" : "NO"} lat=${tr.latencyS ?? "?"}s | ${answer.slice(0, 50)}`);
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
  if (sig.badResponses.length) rep.hardFails.push(`${sig.badResponses.length} HTTP>=400: ${sig.badResponses[0]}`);
  if (sig.wsClosures.length) rep.hardFails.push(`bad WS close: ${sig.wsClosures[0]}`);
  rep.pass = rep.hardFails.length === 0;
  rep.finishedAt = new Date().toISOString();
  return rep;
}

(async () => {
  const wanted = process.argv.slice(2).filter((c) => LANGS[c]);
  const codes = wanted.length ? wanted : Object.keys(LANGS);
  const out = { runId: H.RUN_ID, base: H.BASE, startedAt: new Date().toISOString(), sessions: [] };
  let slot = 93;
  for (const code of codes) {
    console.log(`\n===== ${LANGS[code].label} (${code}) via Any language =====`);
    const rep = await runLanguage(code, slot++);
    out.sessions.push(rep);
    console.log(`  => ${rep.pass ? "PASS" : "FAIL"} session=${rep.sessionId || "?"} picked=${rep.pickedLanguage || "?"} ${rep.hardFails.length ? "| HARD: " + rep.hardFails.join(" | ") : ""}`);
    if (rep.warns.length) console.log(`     warns: ${rep.warns.join(" | ")}`);
  }
  fs.mkdirSync(H.OUT, { recursive: true });
  fs.writeFileSync(`${H.OUT}/languages_report.json`, JSON.stringify(out, null, 2));
  const turns = out.sessions.flatMap((s) => s.turns);
  const ok = turns.filter((t) => t.inputReceived && t.heardOk && t.toolOk && t.botSpoke && t.textOk).length;
  console.log(`\n===== ${out.sessions.filter((s) => s.pass).length}/${out.sessions.length} languages, ${ok}/${turns.length} turns passed =====`);
  process.exit(out.sessions.every((s) => s.pass) ? 0 : 1);
})();
