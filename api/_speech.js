/**
 * api/_speech.js
 *
 * Pure functions for the speech-to-text step (no network, no AI call). The leading underscore
 * keeps Vercel from treating this file as an API route.
 *
 * What it does, and the rules it keeps:
 *
 *  1. Chooses what to ask Deepgram for: the model, the language (from an allow-list, set by the
 *     server, never by the browser) and a list of clinical key terms to boost.
 *
 *  2. Cleans the transcript in three tiers, from safest to least safe:
 *       a. FORMAT   spelled-out abbreviations become the usual form ("s p o 2" -> "SpO2").
 *                   Applied. Not shown to the nurse (it changes no meaning).
 *       b. PHRASE   a word sequence that is not a real phrase and has one known clinical meaning
 *                   ("Bacter signs" -> "vital signs"). Applied, and ALWAYS shown to the nurse
 *                   with the original, so nothing is changed silently.
 *       c. SUGGEST  something looks wrong but the fix is a guess. The text is NOT changed. The
 *                   nurse is asked to check it.
 *
 *  3. Flags what it is unsure of, and never changes it: doses, units, measurements and medicine
 *     names that Deepgram reported with low confidence, and doses with no unit.
 *
 * HARD RULES (enforced by tests that run on many random transcripts):
 *   - Digits, units and medicine names are never added, removed, changed or reordered.
 *   - Medicine names are never corrected, only flagged.
 *   - The raw transcript is always returned beside the cleaned one.
 *   - Running the cleaner on its own output changes nothing.
 *   - Junk input (empty, null, wrong type) never throws.
 */

// ---------------------------------------------------------------------------------
// What to ask Deepgram for
// ---------------------------------------------------------------------------------

export const MODEL = "nova-3-medical";

/** English codes confirmed in Deepgram's documentation. Deepgram has no Nigerian English code. */
export const ALLOWED_LANGUAGES = ["en", "en-US", "en-AU", "en-GB", "en-IN", "en-NZ"];
export const DEFAULT_LANGUAGE = "en";

/** The language comes from the server's environment, and only from the allow-list. */
export function pickLanguage(env = {}) {
  const wanted = String(env.DEEPGRAM_LANGUAGE || "").trim();
  return ALLOWED_LANGUAGES.includes(wanted) ? wanted : DEFAULT_LANGUAGE;
}

/**
 * Key terms boost recognition of these words and phrases (Deepgram allows up to 100 per request).
 *
 * Deliberately NOT included: medicine names. Boosting a medicine name can pull a different, similar
 * sounding medicine toward it, and a wrong medicine in a transcript is worse than an unusual one.
 * Medicine names are checked and flagged instead.
 */
export const KEYTERMS = [
  // vital signs and observations
  "vital signs", "blood pressure", "pulse rate", "heart rate", "respiratory rate", "oxygen saturation",
  "SpO2", "temperature", "Glasgow Coma Scale", "GCS", "pupils equal and reactive to light",
  "intake and output", "urine output", "fluid balance", "input output chart", "blood glucose",
  "random blood sugar", "capillary refill", "mean arterial pressure",
  // how the patient presents
  "afebrile", "febrile", "tachycardic", "bradycardic", "tachypnoeic", "hypotensive", "hypertensive",
  "dyspnoea", "cyanosis", "oedema", "pallor", "jaundice", "dehydrated", "drowsy", "restless",
  "unresponsive", "conscious and alert", "oriented to time place and person", "seizure",
  "vomiting", "diarrhoea", "abdominal pain", "chest pain", "shortness of breath", "melaena",
  "haematuria", "epistaxis", "wheeze", "crepitations",
  // care and procedures
  "nil per os", "nasogastric tube", "urinary catheter", "intravenous cannula", "intravenous fluids",
  "wound dressing", "pressure area care", "repositioning", "nebulisation", "oxygen therapy",
  "face mask", "nasal prongs", "suction", "blood transfusion", "bed bath", "oral care",
  // tests
  "haemoglobin", "packed cell volume", "malaria parasite", "rapid diagnostic test", "full blood count",
  "urinalysis", "electrolytes", "chest X-ray", "ECG",
  // handover
  "ward round", "doctor is aware", "handover", "shift report", "nursing care plan", "next of kin",
];

if (KEYTERMS.length > 100) throw new Error("Deepgram accepts at most 100 key terms per request.");

/** The Deepgram request address for a recording. */
export function buildListenUrl({ language = DEFAULT_LANGUAGE, keyterms = KEYTERMS } = {}) {
  const lang = ALLOWED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
  const query = [
    `model=${MODEL}`,
    `language=${encodeURIComponent(lang)}`,
    "smart_format=true",
    "punctuate=true",
    ...keyterms.slice(0, 100).map((term) => `keyterm=${encodeURIComponent(term)}`),
  ];
  return `https://api.deepgram.com/v1/listen?${query.join("&")}`;
}

/** Pulls the transcript and the per-word confidence out of Deepgram's reply. Missing parts become empty, never an error. */
export function parseDeepgram(data) {
  const alt = data?.results?.channels?.[0]?.alternatives?.[0];
  const transcript = typeof alt?.transcript === "string" ? alt.transcript : "";
  const words = Array.isArray(alt?.words)
    ? alt.words
        .filter((w) => w && typeof w.word === "string")
        .map((w) => ({
          word: w.punctuated_word || w.word,
          bare: w.word,
          confidence: typeof w.confidence === "number" ? w.confidence : null,
          start: typeof w.start === "number" ? w.start : null,
          end: typeof w.end === "number" ? w.end : null,
        }))
    : [];
  return { transcript, words };
}

// ---------------------------------------------------------------------------------
// Tier a: FORMAT. Spelled-out abbreviations. No change of meaning.
// ---------------------------------------------------------------------------------

const FORMAT_RULES = [
  // "s p o 2", "s.p.o.2", "spo2", "sp02"
  { re: /\bs\.?\s?p\.?\s?o\.?\s?2\b/gi, to: "SpO2", why: "abbreviation" },
  // "g c s", "g.c.s"
  { re: /\bg\.?\s?c\.?\s?s\b/gi, to: "GCS", why: "abbreviation" },
  // "b p", "b.p.", "bp"
  { re: /\bb\.?\s?p\b/gi, to: "BP", why: "abbreviation" },
  // "n p o", "n.p.o."
  { re: /\bn\.?\s?p\.?\s?o\b/gi, to: "NPO", why: "abbreviation" },
  // "i v fluids", "i.v. line"; only before a word that makes the meaning clear
  { re: /\bi\.?\s?v\.?\s+(fluids?|line|cannula|access|drip|infusion)\b/gi, to: "IV $1", why: "abbreviation" },
];

// ---------------------------------------------------------------------------------
// Tier b: PHRASE. Not a real phrase, one clinical meaning. Applied, and always shown.
// ---------------------------------------------------------------------------------

/**
 * Every entry here must be a sequence that is not an ordinary English or clinical phrase on its
 * own, so that the replacement cannot change a correct sentence.
 * "Bacter signs" is a real error reported by a nurse using Handova. The rest are the same sound
 * pattern. Add an entry only when it meets that rule and a nurse has seen the error.
 */
const PHRASE_RULES = [
  { re: /\bbacter\s+(signs?)\b/gi, to: (m) => `vital ${m[1].toLowerCase()}` },
  { re: /\bbital\s+(signs?)\b/gi, to: (m) => `vital ${m[1].toLowerCase()}` },
  { re: /\bvital\s+science\b/gi, to: () => "vital signs" },
];

// ---------------------------------------------------------------------------------
// Tier c: SUGGEST. Looks wrong, the fix is a guess, so the text is left alone.
// ---------------------------------------------------------------------------------

// Words that legitimately come before "signs".
const SIGN_MODIFIERS = new Set([
  "vital", "clinical", "physical", "warning", "danger", "early", "late", "soft", "hard", "neurological",
  "focal", "cardinal", "meningeal", "peritoneal", "infective", "localising", "localizing", "lateralising",
  "lateralizing", "these", "those", "any", "some", "no", "the", "and", "other", "all", "his", "her", "its",
  "their", "positive", "negative", "new", "worsening", "same", "similar", "of", "with", "without", "few",
  "many", "visible", "obvious", "possible", "stop", "road", "traffic", "star", "zodiac",
]);

// A vital-signs reading follows ("BP 120/80", "pulse 88", "temperature 37", "SpO2 96").
const VITALS_CUE = /\b(?:bp|blood pressure|pulse|heart rate|temp(?:erature)?|spo2|saturation|respiratory rate|resp(?:irations?)?|rr|\d{2,3}\s?\/\s?\d{2,3})\b/i;

// ---------------------------------------------------------------------------------
// Doses, measurements and medicine names: found, checked, never changed
// ---------------------------------------------------------------------------------

export const LOW_CONFIDENCE = 0.7; // placeholder: tune against real recordings with tools/voice-eval.mjs

const UNIT = /^(?:mg|mcg|µg|ug|g|kg|ml|mls|l|litre|litres|liter|liters|iu|unit|units|mmol|mmhg|bpm|percent|%|degrees?)$/i;
const NUMBER = /^\d+(?:[.,]\d+)?(?:\/\d+)?%?$/;
const NUMBER_WORD = /^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|point|half)$/i;
const MEASURE_CUE = /^(?:bp|pressure|pulse|temp|temperature|spo2|saturation|rate|sugar|glucose|gcs|weight|output|input)$/i;
const NOT_A_MEDICINE = new Set([
  "give", "given", "gave", "dose", "doses", "about", "around", "patient", "tablet", "tablets", "capsule", "capsules",
  "with", "then", "took", "taking", "take", "stat", "oral", "mixed", "total", "after", "before", "every", "daily",
  "twice", "thrice", "again", "until", "since", "while", "during", "approximately", "almost", "nearly", "over",
  "pressure", "pulse", "temperature", "saturation", "rate", "reading", "readings", "output", "input", "glucose", "sugar",
  "weight", "normal", "reads", "read", "now", "was", "were", "has", "had", "have", "his", "her",
]);
// Endings that mark many medicine names. Used only to decide what to double-check, never to change a word.
const DRUG_ENDINGS = /(?:pril|sartan|olol|dipine|statin|mycin|cillin|azole|floxacin|cycline|zepam|azolam|oxetine|tidine|prazole|thiazide|semide|formin|glitazone|gliptin|parin|xaban|caine|phylline|terol|tropium|cef\w*|vir|mab)$/i;

const bare = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9%./µ]/g, "");
const isNumberToken = (t) => NUMBER.test(t) || NUMBER_WORD.test(t);
const looksLikeMedicine = (t) => /^[a-z]{4,}$/.test(t) && !NOT_A_MEDICINE.has(t) && !UNIT.test(t);

function flag(kind, text, confidence, why) {
  return { kind, text, confidence: confidence == null ? null : Math.round(confidence * 100) / 100, message: why };
}

/** Flags what Deepgram was unsure of, and doses spoken with no unit. Never changes the text. */
export function findUncertainties(transcript, wordList = []) {
  const words = Array.isArray(wordList) ? wordList.filter((w) => w && typeof w === "object") : [];
  const flags = [];
  const seen = new Set();
  const add = (f) => {
    const key = `${f.kind}:${f.text.toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); flags.push(f); }
  };

  const toks = words.map((w) => ({ shown: w.word, b: bare(w.bare ?? w.word), c: w.confidence }));

  // 1. From word confidence: dose = number + unit, with the medicine name just before it
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!isNumberToken(t.b)) continue;
    const next = toks[i + 1];
    const hasUnit = !!next && UNIT.test(next.b);
    const span = hasUnit ? [t, next] : [t];
    const confs = span.map((x) => x.c).filter((c) => typeof c === "number");
    const low = confs.length ? Math.min(...confs) : null;
    const label = span.map((x) => x.shown).join(" ");

    if (hasUnit) {
      if (low != null && low < LOW_CONFIDENCE) add(flag("dose", label, low, "The dose was heard with low confidence. Check the number and the unit."));
      const prev = toks[i - 1];
      if (prev && looksLikeMedicine(prev.b)) {
        if (typeof prev.c === "number" && prev.c < LOW_CONFIDENCE) add(flag("medication", prev.shown, prev.c, "This medicine name was heard with low confidence. Check the spelling."));
      }
    } else {
      // A measurement (BP, pulse, temperature...) read with low confidence
      const cue = [toks[i - 1], toks[i - 2], toks[i - 3]].some((x) => x && MEASURE_CUE.test(x.b));
      if (cue && low != null && low < LOW_CONFIDENCE) add(flag("measurement", label, low, "This reading was heard with low confidence. Check the number."));
    }
  }

  // 2. From the text alone: a medicine-like word followed by a number but no unit
  const text = typeof transcript === "string" ? transcript : "";
  const re = /\b([A-Za-z]{4,})\s+(\d+(?:\.\d+)?)(?![\d.])(?!\s?(?:\/|\d|%|mg|mcg|µg|ug|g|kg|ml|mls|l|litres?|liters?|iu|units?|mmol|mmhg|bpm|degrees?|percent)\b)/gi;
  for (const m of text.matchAll(re)) {
    const word = bare(m[1]);
    if (DRUG_ENDINGS.test(word) && !NOT_A_MEDICINE.has(word)) {
      add(flag("dose", `${m[1]} ${m[2]}`, null, "A dose was spoken with no unit. Add the unit (for example mg or ml) so it cannot be misread."));
    }
  }
  return flags.slice(0, 8);
}

// ---------------------------------------------------------------------------------
// The cleaner
// ---------------------------------------------------------------------------------

const matchCase = (original, replacement) =>
  /^[A-Z]/.test(original) ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;

/**
 * { transcript, words } in; { text, rawText, notes } out.
 * notes: [{ kind: "changed" | "check" | "suggest", ... }] for the nurse to see. Format-only
 * changes are not listed, because they change no meaning.
 */
export function processTranscript(input) {
  const { transcript, words: rawWords } = input && typeof input === "object" ? input : {};
  const words = Array.isArray(rawWords) ? rawWords.filter((w) => w && typeof w === "object") : [];
  const rawText = typeof transcript === "string" ? transcript.trim() : "";
  if (!rawText) return { text: "", rawText: "", notes: [] };

  let text = rawText.replace(/\s+/g, " ");
  const notes = [];

  // a. format
  for (const rule of FORMAT_RULES) text = text.replace(rule.re, rule.to);

  // b. phrase
  for (const rule of PHRASE_RULES) {
    text = text.replace(rule.re, (...args) => {
      const found = args[0];
      const to = matchCase(found, rule.to(args));
      notes.push({ kind: "changed", from: found, to, message: `Changed "${found}" to "${to}". Edit the text if this is wrong.` });
      return to;
    });
  }

  // c. suggest, on the text as it now stands
  const around = /\b([A-Za-z]{3,})\s+(signs?)\b/g;
  for (const m of text.matchAll(around)) {
    const modifier = m[1].toLowerCase();
    if (SIGN_MODIFIERS.has(modifier)) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
    if (VITALS_CUE.test(after)) {
      notes.push({
        kind: "suggest", from: m[0], to: `vital ${m[2]}`,
        message: `"${m[0]}" may have been "vital ${m[2]}". The text was not changed. Please check.`,
      });
    }
  }

  // uncertain doses, measurements and medicine names: never changed
  for (const f of findUncertainties(rawText, words)) {
    notes.push({ kind: "check", from: f.text, field: f.kind, confidence: f.confidence, message: f.message });
  }

  return { text: text.replace(/\s{2,}/g, " ").trim(), rawText, notes };
}
