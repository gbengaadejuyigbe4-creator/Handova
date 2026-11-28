import { describe, expect, it } from "vitest";
import {
  ALLOWED_LANGUAGES, DEFAULT_LANGUAGE, KEYTERMS, LOW_CONFIDENCE, MODEL,
  buildListenUrl, findUncertainties, parseDeepgram, pickLanguage, processTranscript,
} from "../api/_speech.js";

// Everything here is invented. The "spoken" lines are what a nurse might dictate; the "heard" lines
// are text-level imitations of speech-to-text mistakes. They are NOT recordings, so they prove how
// the cleaning logic behaves, not how accurate the speech engine is. Audio accuracy is measured
// with tools/voice-eval.mjs on real recordings.

/** Builds a word list the way Deepgram returns one. `low` maps a word to a low confidence. */
const wordsOf = (text, low = {}) =>
  text.split(/\s+/).filter(Boolean).map((w, i) => {
    const key = w.toLowerCase().replace(/[^a-z0-9%./]/g, "");
    return { word: w, bare: key, confidence: key in low ? low[key] : 0.97, start: i * 0.4, end: i * 0.4 + 0.3 };
  });
const run = (transcript, low) => processTranscript({ transcript, words: wordsOf(transcript, low) });
const kinds = (r) => r.notes.map((n) => n.kind);

// ---------------------------------------------------------------------------------------
describe("what is asked of Deepgram", () => {
  it("uses the medical model and the plain English code by default", () => {
    const url = buildListenUrl();
    expect(url).toContain(`model=${MODEL}`);
    expect(url).toContain(`language=${DEFAULT_LANGUAGE}&`);
    expect(url).toContain("smart_format=true");
    expect(url).toContain("punctuate=true");
  });
  it("sends every key term, spaces written as %20", () => {
    const url = buildListenUrl();
    expect(url).toContain("keyterm=vital%20signs");
    expect(url.match(/keyterm=/g)).toHaveLength(KEYTERMS.length);
    expect(url).not.toContain("+");
  });
  it("never sends more than 100 key terms, and keeps within the word budget", () => {
    expect(KEYTERMS.length).toBeLessThanOrEqual(100);
    expect(buildListenUrl({ keyterms: Array.from({ length: 150 }, (_, i) => `term${i}`) }).match(/keyterm=/g)).toHaveLength(100);
    const words = KEYTERMS.join(" ").split(/\s+/).length;
    expect(words).toBeLessThan(375); // Deepgram's limit is about 500 tokens; this leaves room
  });
  it("has no duplicate key terms", () => {
    expect(new Set(KEYTERMS.map((t) => t.toLowerCase())).size).toBe(KEYTERMS.length);
  });
  it("boosts no medicine names, because a boosted name can pull a similar-sounding one into the text", () => {
    const medicines = ["furosemide", "metformin", "paracetamol", "amoxicillin", "ceftriaxone", "insulin", "artemether", "lumefantrine",
      "amlodipine", "lisinopril", "gentamicin", "ciprofloxacin", "diazepam", "morphine", "tramadol", "ibuprofen", "omeprazole", "metronidazole",
      "oxytocin", "salbutamol", "hydrocortisone", "dexamethasone", "heparin", "warfarin", "atenolol", "captopril", "nifedipine"];
    const all = KEYTERMS.join(" ").toLowerCase();
    for (const m of medicines) expect(all).not.toContain(m);
  });
  it("includes the term the nurse reported", () => {
    expect(KEYTERMS).toContain("vital signs");
  });
  it("takes the language from the server's environment, only from the allow-list", () => {
    expect(pickLanguage({})).toBe("en");
    expect(pickLanguage({ DEEPGRAM_LANGUAGE: "en-GB" })).toBe("en-GB");
    expect(pickLanguage({ DEEPGRAM_LANGUAGE: "en-IN" })).toBe("en-IN");
    expect(pickLanguage({ DEEPGRAM_LANGUAGE: "multi" })).toBe("en");
    expect(pickLanguage({ DEEPGRAM_LANGUAGE: "en-NG" })).toBe("en"); // Deepgram has no Nigerian English code
    expect(pickLanguage({ DEEPGRAM_LANGUAGE: "en&model=nova-2" })).toBe("en");
    expect(pickLanguage({ DEEPGRAM_LANGUAGE: " en-AU " })).toBe("en-AU");
  });
  it("cannot be talked into another language or a changed address", () => {
    expect(buildListenUrl({ language: "xx&model=other" })).toContain("language=en&");
    for (const l of ALLOWED_LANGUAGES) expect(buildListenUrl({ language: l })).toContain(`language=${l}&`);
  });
});

describe("reading Deepgram's reply", () => {
  it("takes the transcript and the confidence of each word", () => {
    const out = parseDeepgram({ results: { channels: [{ alternatives: [{
      transcript: "Vital signs stable.",
      words: [
        { word: "vital", punctuated_word: "Vital", confidence: 0.99, start: 0, end: 0.3 },
        { word: "signs", punctuated_word: "signs", confidence: 0.4, start: 0.3, end: 0.6 },
      ],
    }] }] } });
    expect(out.transcript).toBe("Vital signs stable.");
    expect(out.words[0]).toMatchObject({ word: "Vital", bare: "vital", confidence: 0.99 });
    expect(out.words[1].confidence).toBe(0.4);
  });
  it("does not fail on missing or odd replies", () => {
    for (const bad of [null, undefined, {}, [], "x", 5, { results: {} }, { results: { channels: [] } }, { results: { channels: [{}] } }]) {
      expect(parseDeepgram(bad)).toEqual({ transcript: "", words: [] });
    }
    expect(parseDeepgram({ results: { channels: [{ alternatives: [{ transcript: "ok", words: [null, 5, { nope: 1 }] }] }] } }))
      .toEqual({ transcript: "ok", words: [] });
  });
});

describe("tier a: spelled-out abbreviations", () => {
  it.each([
    ["s p o 2 is 96 percent", "SpO2 is 96 percent"],
    ["S.P.O.2 96%", "SpO2 96%"],
    ["spo2 94 percent", "SpO2 94 percent"],
    ["g c s 15", "GCS 15"],
    ["b p 120 over 80", "BP 120 over 80"],
    ["bp 130/80", "BP 130/80"],
    ["n p o since midnight", "NPO since midnight"],
    ["on i v fluids", "on IV fluids"],
    ["i.v. line patent", "IV line patent"],
  ])("%s", (heard, expected) => {
    const r = run(heard);
    expect(r.text).toBe(expected);
    expect(r.notes).toEqual([]); // formatting changes no meaning, so nothing is listed
  });
  it("keeps the full stop after an abbreviation", () => {
    expect(run("Checked the bp. Pulse is 88.").text).toBe("Checked the BP. Pulse is 88.");
  });
  it("leaves unrelated words alone", () => {
    for (const t of ["I'm giving i m medication", "Vitamin B was given", "He has a bad cough", "the b side", "ivy leaf extract", "the bpm was 80", "npov"]) {
      expect(run(t).text).toBe(t);
    }
  });
});

describe("tier b: a word sequence that is not a real phrase", () => {
  it("corrects the reported error and says so", () => {
    const r = run("Bacter signs: BP 120/80, pulse 88, temperature 36.8.");
    expect(r.text).toBe("Vital signs: BP 120/80, pulse 88, temperature 36.8.");
    expect(r.rawText).toBe("Bacter signs: bp 120/80, pulse 88, temperature 36.8.".replace("bp", "BP"));
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ kind: "changed", from: "Bacter signs", to: "Vital signs" });
    expect(r.notes[0].message).toContain("Bacter signs");
  });
  it("keeps the nurse's capitals, or lack of them", () => {
    expect(run("bacter signs stable").text).toBe("vital signs stable");
    expect(run("Bacter signs stable").text).toBe("Vital signs stable");
    expect(run("BACTER SIGNS stable").text).toBe("Vital signs stable");
  });
  it("handles the singular, other sound-alikes and repeats", () => {
    expect(run("bacter sign taken").text).toBe("vital sign taken");
    expect(run("Bital signs taken").text).toBe("Vital signs taken");
    expect(run("vital science taken at 8").text).toBe("vital signs taken at 8");
    const r = run("Bacter signs at 8, bacter signs again at 10");
    expect(r.text).toBe("Vital signs at 8, vital signs again at 10");
    expect(r.notes).toHaveLength(2);
  });
  it("does not touch a correct phrase", () => {
    for (const t of ["Vital signs stable", "Signs of bacterial infection noted", "Bacterial signs absent", "bacteria in the urine", "Warning signs explained to the family"]) {
      expect(run(t).text).toBe(t);
      expect(kinds(run(t))).not.toContain("changed");
    }
  });
  it("never alters a number, unit or medicine in the same sentence", () => {
    const r = run("Bacter signs BP 120/80 pulse 88 furosemide 40 mg given at 08:30");
    expect(r.text).toContain("BP 120/80 pulse 88 furosemide 40 mg given at 08:30");
  });
});

describe("tier c: looks wrong, the fix is a guess", () => {
  it("suggests, but does not change the text", () => {
    const heard = "Bacterial signs BP 120/80 pulse 88";
    const r = run(heard);
    expect(r.text).toBe(heard);
    expect(r.notes.find((n) => n.kind === "suggest")).toMatchObject({ from: "Bacterial signs", to: "vital signs" });
  });
  it("suggests only when a reading follows", () => {
    expect(kinds(run("Bacterial signs are present on the wound"))).not.toContain("suggest");
    expect(kinds(run("Fresh signs BP 110/70"))).toContain("suggest");
  });
  it("does not suggest for ordinary phrases before readings", () => {
    for (const t of ["Warning signs, BP 120/80", "No signs of distress, pulse 88", "Neurological signs normal, GCS 15", "Clinical signs stable, temperature 37"]) {
      expect(kinds(run(t))).not.toContain("suggest");
    }
  });
});

describe("uncertain doses, readings and medicine names: flagged, never changed", () => {
  it("flags a dose heard with low confidence", () => {
    const heard = "Gave furosemide 40 mg IV";
    const r = run(heard, { "40": 0.41 });
    expect(r.text).toBe(heard);
    expect(r.notes).toEqual([expect.objectContaining({ kind: "check", field: "dose", from: "40 mg", confidence: 0.41 })]);
  });
  it("flags a low-confidence unit", () => {
    expect(run("Gave 5 mg stat", { mg: 0.5 }).notes[0]).toMatchObject({ kind: "check", field: "dose" });
  });
  it("flags a medicine name heard with low confidence, and only then", () => {
    const heard = "Gave ceftriaxone 1 g IV";
    const r = run(heard, { ceftriaxone: 0.52 });
    expect(r.text).toBe(heard);
    expect(r.notes.find((n) => n.field === "medication")).toMatchObject({ from: "ceftriaxone" });
    expect(run(heard).notes).toEqual([]);
  });
  it("flags a vital-sign reading heard with low confidence", () => {
    const r = run("BP 150/90 and pulse 112", { "112": 0.55 });
    expect(r.notes).toEqual([expect.objectContaining({ kind: "check", field: "measurement", from: "112" })]);
  });
  it("does not flag a confident reading, or a low-confidence ordinary word", () => {
    expect(run("BP 150/90 and pulse 112 and a good night", { good: 0.3, night: 0.2 }).notes).toEqual([]);
  });
  it("flags a dose spoken with no unit", () => {
    const r = processTranscript({ transcript: "Gave furosemide 40 at eight", words: [] });
    expect(r.text).toBe("Gave furosemide 40 at eight");
    expect(r.notes).toEqual([expect.objectContaining({ kind: "check", field: "dose", from: "furosemide 40" })]);
  });
  it("does not flag readings or doses that have a unit", () => {
    for (const t of ["Pulse 88", "Temperature 37", "Furosemide 40 mg", "Ceftriaxone 1 g", "BP 120/80", "Atenolol 50 mcg", "Heparin 5000 units"]) {
      expect(processTranscript({ transcript: t, words: [] }).notes).toEqual([]);
    }
  });
  it("lists each problem once, and no more than eight", () => {
    const heard = Array.from({ length: 12 }, (_, i) => `furosemide ${10 + i}`).join(", ");
    expect(processTranscript({ transcript: heard, words: [] }).notes.length).toBeLessThanOrEqual(8);
    const twice = processTranscript({ transcript: "Furosemide 40 and furosemide 40", words: [] });
    expect(twice.notes).toHaveLength(1);
  });
  it("uses the confidence line that is in the code", () => {
    expect(LOW_CONFIDENCE).toBe(0.7);
    expect(run("Gave 5 mg", { "5": LOW_CONFIDENCE }).notes).toEqual([]);
    expect(run("Gave 5 mg", { "5": LOW_CONFIDENCE - 0.01 }).notes).toHaveLength(1);
  });
  it("accepts words with no confidence at all", () => {
    expect(() => processTranscript({ transcript: "Gave 5 mg", words: [{ word: "Gave" }, { word: "5" }, { word: "mg" }] })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------
// Dictation a nurse might really give. Invented. Nigerian ward vocabulary and phrasing.
// "heard" imitates speech-to-text mistakes at the text level. Nothing here is audio.
// ---------------------------------------------------------------------------------------
const CORPUS = [
  { heard: "Bacter signs taken at 8 am. BP 120 over 80, pulse 88, temperature 36.8, SpO2 98 percent.",
    mustHave: ["Vital signs taken at 8 am", "BP 120 over 80", "pulse 88", "temperature 36.8", "SpO2 98 percent"] },
  { heard: "Patient is conscious and alert, oriented to time place and person. Bacter signs stable.",
    mustHave: ["conscious and alert", "Vital signs stable"] },
  { heard: "Intake 1500 ml, urine output 400 ml over 8 hours. Fluid balance positive.",
    mustHave: ["1500 ml", "400 ml over 8 hours"] },
  { heard: "Gave paracetamol 1 g IV at 6 am for temperature 38.4. Doctor is aware.",
    mustHave: ["paracetamol 1 g IV at 6 am", "temperature 38.4"] },
  { heard: "Malaria parasite positive. Artemether lumefantrine 80 mg started per doctor's order.",
    mustHave: ["Artemether lumefantrine 80 mg"] },
  { heard: "Random blood sugar 18.2 mmol. Doctor informed. Insulin 6 units subcutaneous given.",
    mustHave: ["18.2 mmol", "Insulin 6 units"] },
  { heard: "GCS 13, pupils equal and reactive to light. Seizure lasting 2 minutes at 3 pm.",
    mustHave: ["GCS 13", "2 minutes", "3 pm"] },
  { heard: "i v fluids running, normal saline 1 litre over 6 hours. Cannula site clean.",
    mustHave: ["IV fluids running", "normal saline 1 litre over 6 hours"] },
  { heard: "N p o since midnight. nasogastric tube in situ. Wound dressing changed, no bleeding.",
    mustHave: ["NPO since midnight", "nasogastric tube in situ"] },
  { heard: "Ceftriaxone 1 g IV given at 10 pm. s p o 2 94 percent on 4 litres of oxygen via face mask.",
    mustHave: ["Ceftriaxone 1 g IV", "SpO2 94 percent on 4 litres"] },
  { heard: "Pt complained of abdominal pain, score 7 out of 10. Metronidazole 500 mg given.",
    mustHave: ["score 7 out of 10", "Metronidazole 500 mg"] },
  { heard: "Respiratory rate 28, using accessory muscles. Salbutamol nebulisation 2.5 mg done at 11.",
    mustHave: ["Respiratory rate 28", "Salbutamol nebulisation 2.5 mg"] },
  { heard: "Bacter signs: BP 90 over 60, pulse 120, temp 39. Patient restless. Doctor called at 2 am.",
    mustHave: ["Vital signs: BP 90 over 60", "pulse 120", "temp 39"] },
  { heard: "Blood transfusion, packed cell volume 22 percent, one unit of blood started at 4 pm.",
    mustHave: ["packed cell volume 22 percent", "one unit of blood"] },
  { heard: "Repositioned two hourly, pressure area care done. Skin intact. Bacter signs normal.",
    mustHave: ["two hourly", "Vital signs normal"] },
];

describe("realistic nursing dictation (text-level)", () => {
  it.each(CORPUS.map((c, i) => [i + 1, c]))("dictation %i: keeps every number, unit and medicine", (_i, c) => {
    const r = run(c.heard);
    for (const phrase of c.mustHave) expect(r.text).toContain(phrase);
    expect(r.text).not.toMatch(/bacter signs?/i);
    expect(r.rawText).toBe(c.heard);
  });
  it("lists a note for every phrase change, so nothing is changed silently", () => {
    for (const c of CORPUS) {
      const r = run(c.heard);
      const changed = (c.heard.match(/bacter signs?/gi) || []).length;
      expect(r.notes.filter((n) => n.kind === "changed")).toHaveLength(changed);
    }
  });
  it("hospital noise: low-confidence junk words around the figures change nothing and raise no false alarm", () => {
    const heard = "Uh the the ward is noisy BP 120 over 80 pulse 88 and furosemide 40 mg given";
    const low = { uh: 0.2, the: 0.3, ward: 0.4, noisy: 0.35 };
    const r = run(heard, low);
    expect(r.text).toBe(heard.replace("BP", "BP"));
    expect(r.notes).toEqual([]);
  });
  it("hospital noise: a smeared dose is flagged, not guessed", () => {
    const heard = "Gave furosemide forty mg IV";
    const r = run(heard, { furosemide: 0.45 });
    expect(r.text).toBe(heard);
    expect(r.notes.some((n) => n.kind === "check")).toBe(true);
  });
  it("clean dictation comes back untouched and with no notes", () => {
    const clean = [
      "Vital signs stable. BP 120/80, pulse 88, temperature 36.8, SpO2 98 percent.",
      "Patient slept well. No complaints. Wound dry and intact.",
      "Gave amlodipine 5 mg at 8 am as prescribed.",
      "Intake 1200 ml, output 900 ml. Bowels opened.",
      "Doctor reviewed the patient on ward round. Plan unchanged.",
      "Oxygen at 2 litres per minute via nasal prongs, SpO2 96 percent.",
      "Warning signs of sepsis explained to the family. BP 110/70.",
      "Signs of bacterial infection absent.",
    ];
    for (const t of clean) {
      const r = run(t);
      expect(r.text).toBe(t);
      expect(r.notes).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------
// The promises, checked on thousands of random transcripts
// ---------------------------------------------------------------------------------------
function rng(seed) { // small deterministic random numbers, so a failure can be replayed
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const POOL = [
  "Bacter", "signs", "sign", "bital", "vital", "science", "BP", "bp", "b", "p", "s", "o", "2", "g", "c", "i", "v", "n",
  "SpO2", "spo2", "GCS", "NPO", "IV", "fluids", "line", "pulse", "temperature", "temp", "rate", "40", "5", "120/80", "98.6", "1500", "08:30",
  "mg", "mcg", "ml", "g", "units", "percent", "%", "furosemide", "paracetamol", "ceftriaxone", "amlodipine", "insulin", "heparin",
  "gave", "given", "at", "of", "and", "the", "patient", "stable", "bacterial", "warning", "clinical", "BACTER", "Signs", "over", "and", ".", ",", ":", "?",
];
const digits = (s) => s.match(/\d+(?:[.,/:]\d+)*/g) || [];
const units = (s) => (s.match(/\b(?:mg|mcg|ml|iu|units?|mmol|percent)\b|%/gi) || []).map((u) => u.toLowerCase());
const medicines = (s) => (s.match(/\b[a-z]{4,}(?:pril|sartan|olol|dipine|statin|mycin|cillin|azole|floxacin|cycline|zepam|semide|formin|parin|xaban|caine|terol|cef\w*|vir|mab|tidine|prazole|thiazide)\b/gi) || [])
  .map((m) => m.toLowerCase());

describe("the promises, on random transcripts", () => {
  const rand = rng(20261127);
  const samples = Array.from({ length: 4000 }, () => {
    const n = 1 + Math.floor(rand() * 18);
    return Array.from({ length: n }, () => POOL[Math.floor(rand() * POOL.length)]).join(rand() < 0.1 ? "  " : " ");
  });
  // include the named medicines among the endings, so the medicine check has something to find
  const withWords = (t) => wordsOf(t, Object.fromEntries(t.split(/\s+/).map((w) => [w.toLowerCase().replace(/[^a-z0-9%./]/g, ""), rand() < 0.3 ? 0.3 : 0.95])));

  it("never adds, removes, changes or reorders a number", () => {
    for (const t of samples) {
      const r = processTranscript({ transcript: t, words: withWords(t) });
      // "s p o 2" and "SpO2" both carry the digit 2, so compare the digits in order
      expect(digits(r.text), `input: ${t}`).toEqual(digits(r.rawText));
    }
  });
  it("never changes a unit", () => {
    for (const t of samples) {
      const r = processTranscript({ transcript: t, words: [] });
      expect(units(r.text), `input: ${t}`).toEqual(units(r.rawText));
    }
  });
  it("never changes, adds or removes a medicine name", () => {
    for (const t of samples) {
      const r = processTranscript({ transcript: t, words: withWords(t) });
      expect(medicines(r.text), `input: ${t}`).toEqual(medicines(r.rawText));
    }
  });
  it("always returns the raw transcript, trimmed, beside the cleaned one", () => {
    for (const t of samples) {
      expect(processTranscript({ transcript: t }).rawText).toBe(t.trim());
    }
  });
  it("leaves its own output alone when run again", () => {
    for (const t of samples) {
      const once = processTranscript({ transcript: t });
      const twice = processTranscript({ transcript: once.text });
      expect(twice.text, `input: ${t}`).toBe(once.text);
    }
  });
  it("lists a note for every phrase it changed", () => {
    for (const t of samples) {
      const r = processTranscript({ transcript: t });
      const phrasesBefore = (r.rawText.match(/\b(?:bacter|bital)\s+signs?\b|\bvital\s+science\b/gi) || []).length;
      expect(r.notes.filter((n) => n.kind === "changed"), `input: ${t}`).toHaveLength(phrasesBefore);
    }
  });
  it("never throws, whatever it is given", () => {
    for (const bad of [undefined, null, 5, {}, [], "", "   ", "\n\t", "☃", "a".repeat(100000), { transcript: 5 }, { transcript: "x", words: "nope" }, { transcript: "x", words: [null, 3] }]) {
      expect(() => processTranscript(bad)).not.toThrow();
      expect(() => processTranscript({ transcript: bad, words: bad })).not.toThrow();
    }
    expect(processTranscript(undefined)).toEqual({ text: "", rawText: "", notes: [] });
  });
  it("only ever produces the three kinds of note", () => {
    for (const t of samples.slice(0, 800)) {
      for (const n of processTranscript({ transcript: t, words: withWords(t) }).notes) {
        expect(["changed", "check", "suggest"]).toContain(n.kind);
        expect(typeof n.message).toBe("string");
      }
    }
  });
});
