import fs from "node:fs";
import * as H from "/sqa/lib/harness.mjs";

const OUT = process.env.SQA_OUT || "/sqa/artifacts/tts-pronunciation";
const TERMS = {
  NVIDIA: { match: /nvidia|n video/i, arpabet: "EH0 N V IH1 D IY0 AH0", ipa: "ɛnˈvɪdiə" },
  Nemotron: { match: /nemotron|nemo tron|nema tron/i, arpabet: "N EH1 M AH0 T R AA2 N", ipa: "ˈnɛmətrɑn" },
  NVCF: { match: /n\s*v\s*c\s*f|nvcf/i, arpabet: "EH1 N V IY1 S IY1 EH1 F", ipa: "ɛn viː siː ɛf" },
  Astra: { match: /astra/i, arpabet: "AE1 S T R AH0", ipa: "ˈæstrə" },
  Pipecat: { match: /pipe\s*cat|pipecat/i, arpabet: "P AY1 P K AE2 T", ipa: "ˈpaɪpˌkæt" },
  Redis: { match: /redis|red\s*iss/i, arpabet: "R EH1 D IH0 S", ipa: "ˈrɛdɪs" },
  SeaweedFS: { match: /seaweed\s*(?:f\s*s|fs)/i, arpabet: "S IY1 W IY2 D EH1 F EH1 S", ipa: "ˈsiːˌwiːd ɛf ɛs" },
  Magpie: { match: /magpie/i, arpabet: "M AE1 G P AY2", ipa: "ˈmæɡˌpaɪ" },
  Chatterbox: { match: /chatterbox/i, arpabet: "CH AE1 T ER0 B AA2 K S", ipa: "ˈtʃætərˌbɑks" },
  Perplexity: { match: /perplexity/i, arpabet: "P ER0 P L EH1 K S AH0 T IY0", ipa: "pərˈplɛksəti" },
  Finnhub: { match: /finn?\s*hub|finnhub/i, arpabet: "F IH1 N HH AH2 B", ipa: "ˈfɪnˌhʌb" },
  WeatherAPI: { match: /weather\s*(?:a\s*p\s*i|api)/i, arpabet: "W EH1 DH ER0 EY1 P IY1 AY1", ipa: "ˈwɛðər eɪ piː aɪ" },
  NGC: { match: /n\s*g\s*c|ngc/i, arpabet: "EH1 N JH IY1 S IY1", ipa: "ɛn dʒiː siː" },
  Kubernetes: { match: /kubernetes/i, arpabet: "K UW2 B ER0 N EH1 T IY0 Z", ipa: "ˌkuːbərˈnɛtiːz" },
  Helm: { match: /helm/i, arpabet: "HH EH1 L M", ipa: "hɛlm" },
  vLLM: { match: /v\s*l\s*l\s*m|vllm/i, arpabet: "V IY1 EH1 L EH1 L EH1 M", ipa: "viː ɛl ɛl ɛm" },
  Riva: { match: /riva|reeva/i, arpabet: "R IY1 V AH0", ipa: "ˈriːvə" },
  H100: { match: /h\s*(?:one hundred|100)/i, arpabet: "EY1 CH W AH1 N HH AH1 N D R AH0 D", ipa: "eɪtʃ wʌn ˈhʌndrəd" },
  ARPAbet: { match: /arpa\s*bet|arpabet/i, arpabet: "AA1 R P AH0 B EH2 T", ipa: "ˈɑrpəˌbɛt" },
  "24/7": { match: /twenty four (?:slash )?seven|24\s*7/i, arpabet: "T W EH1 N T IY0 F AO1 R S EH1 V AH0 N", ipa: "ˌtwɛnti ˈfɔr ˈsɛvən", normalization: "twenty four seven" },
};

const PROBES = [
  ["NVIDIA", "NVIDIA"], ["Nemotron", "Nemotron"], ["NVCF", "N V C F"],
  ["Astra", "Astra"], ["Pipecat", "Pipecat"], ["Redis", "Redis"],
  ["SeaweedFS", "Seaweed F S"], ["Magpie", "Magpie"], ["Chatterbox", "Chatterbox"],
  ["Perplexity", "Perplexity"], ["Finnhub", "Finnhub"], ["WeatherAPI", "Weather A P I"],
  ["NGC", "N G C"], ["Kubernetes", "Kubernetes"], ["Helm", "Helm"],
  ["vLLM", "V L L M"], ["Riva", "Riva"], ["H100", "H one hundred"],
  ["ARPAbet", "ARPA bet"], ["24/7", "twenty four seven"],
].map(([term, spoken]) => ({ term, spoken }));

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function runVoice(tts) {
  const signals = H.newSignals();
  const browser = await H.launchBrowser({ headless: false });
  const result = { tts, turns: [], consoleErrors: signals.consoleErrors, badResponses: signals.badResponses };
  try {
    const { page } = await H.newPage(browser, signals);
    await page.goto(H.BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await H.sleep(1500);
    await H.selectExample(page, { example: "generic", model: "lightning", tts, consent: true });
    result.connection = await H.startConversation(page, { timeoutMs: 45000 });
    result.sessionId = await H.sessionId(page);
    if (!result.connection.connected) throw new Error(`${tts} session did not connect`);
    if (!(await H.waitForSettledWelcome(page))) throw new Error(`${tts} welcome did not settle`);
    for (let index = 0; index < PROBES.length; index++) {
      const probe = PROBES[index];
      const prompt = `Repeat ${probe.spoken}`;
      const turn = await H.turn(page, prompt, `${tts}_pron_${index + 1}`, { settle: true });
      const botAsr = clean(turn.botAsr);
      const domBot = clean(turn.domBot);
      const assessment = {
        term: probe.term,
        asrMatch: TERMS[probe.term].match.test(botAsr),
        textMatch: TERMS[probe.term].match.test(domBot),
        arpabet: TERMS[probe.term].arpabet,
        ipa: TERMS[probe.term].ipa,
        normalization: TERMS[probe.term].normalization || null,
      };
      const record = {
        probe: index + 1,
        term: probe.term,
        expected: probe.spoken,
        heardByApp: clean(turn.domUser),
        assistantText: domBot,
        independentAsr: botAsr,
        botSpoke: turn.botSpoke,
        wav: turn.wav,
        assessments: [assessment],
      };
      result.turns.push(record);
      console.log(JSON.stringify({ tts, ...record }));
    }
    await H.endConversation(page).catch(() => {});
  } catch (error) {
    result.fatal = String(error);
  } finally {
    await browser.close().catch(() => {});
  }
  return result;
}

const report = { base: H.BASE, startedAt: new Date().toISOString(), voices: [] };
for (const tts of ["magpie", "chatterbox"]) report.voices.push(await runVoice(tts));
report.finishedAt = new Date().toISOString();
report.candidates = Object.fromEntries(Object.entries(TERMS).map(([term, value]) => [term, {
  arpabet: value.arpabet,
  ipa: value.ipa,
  normalization: value.normalization || null,
  observations: report.voices.flatMap((voice) => voice.turns.flatMap((turn) =>
    turn.assessments.filter((assessment) => assessment.term === term).map((assessment) => ({
      tts: voice.tts,
      asrMatch: assessment.asrMatch,
      textMatch: assessment.textMatch,
      independentAsr: turn.independentAsr,
      wav: turn.wav,
    })))),
}]));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/pronunciation_probe_report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ voices: report.voices.map((voice) => ({ tts: voice.tts, fatal: voice.fatal || null, turns: voice.turns.length })) }));
process.exit(report.voices.some((voice) => voice.fatal) ? 1 : 0);
