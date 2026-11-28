/**
 * tools/voice-metrics.js
 *
 * Plain functions for measuring speech-to-text accuracy. They are used by tools/voice-eval.mjs,
 * which you run on your own recordings, and they are covered by tests.
 *
 * Two kinds of score matter and they are kept apart:
 *   - Word error rate (WER): how many words are wrong overall. Useful, but a wrong "the" counts
 *     the same as a wrong dose.
 *   - Critical recall: of the numbers, units, medicine names and clinical terms that were SAID,
 *     how many appear in the transcript. This is the score that protects patients.
 */

import { KEYTERMS } from "../api/_speech.js";

/** Lower-case words, with punctuation at the edges removed. Numbers like 36.8 and 120/80 stay whole. */
export function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[,;:!?()"“”]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.'’\-]+|[.'’\-]+$/g, ""))
    .filter(Boolean);
}

/** Word error rate by edit distance: (substitutions + deletions + insertions) / words in the reference. */
export function wer(reference, hypothesis) {
  const r = tokenize(reference);
  const h = tokenize(hypothesis);
  if (r.length === 0) return { distance: h.length, refLength: 0, rate: h.length === 0 ? 0 : 1 };
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return { distance: prev[h.length], refLength: r.length, rate: prev[h.length] / r.length };
}

const UNIT = /^(?:mg|mcg|µg|ug|g|kg|ml|mls|l|litre|litres|iu|unit|units|mmol|mmhg|bpm|percent|%)$/;
const NUMBER = /^\d+(?:[.,]\d+)?(?:\/\d+)?%?$/;
const MEDICINE = /^[a-z]{4,}(?:pril|sartan|olol|dipine|statin|mycin|cillin|azole|floxacin|cycline|zepam|semide|formin|parin|xaban|caine|terol|tidine|prazole|thiazide)$|^(?:paracetamol|insulin|artemether|lumefantrine|ceftriaxone|metronidazole|salbutamol|tramadol|morphine|ibuprofen|diazepam|oxytocin|gentamicin|amoxicillin|hydrocortisone|dexamethasone)$/;

/** What was said that must not be lost: numbers, units, medicine names, and clinical key terms. */
export function criticalTokens(reference) {
  const toks = tokenize(reference);
  const text = ` ${toks.join(" ")} `;
  return {
    numbers: toks.filter((t) => NUMBER.test(t)),
    units: toks.filter((t) => UNIT.test(t)),
    medicines: toks.filter((t) => MEDICINE.test(t)),
    terms: KEYTERMS.filter((k) => text.includes(` ${tokenize(k).join(" ")} `)),
  };
}

function multisetMissing(expected, haystackTokens) {
  const pool = new Map();
  for (const t of haystackTokens) pool.set(t, (pool.get(t) || 0) + 1);
  const missing = [];
  for (const e of expected) {
    if ((pool.get(e) || 0) > 0) pool.set(e, pool.get(e) - 1);
    else missing.push(e);
  }
  return missing;
}

/** Of the critical items that were said, how many are in the transcript. */
export function criticalRecall(reference, hypothesis) {
  const crit = criticalTokens(reference);
  const hypTokens = tokenize(hypothesis);
  const hypText = ` ${hypTokens.join(" ")} `;
  const out = {};
  for (const kind of ["numbers", "units", "medicines"]) {
    const missing = multisetMissing(crit[kind], hypTokens);
    out[kind] = { expected: crit[kind].length, found: crit[kind].length - missing.length, missing };
  }
  const missingTerms = crit.terms.filter((k) => !hypText.includes(` ${tokenize(k).join(" ")} `));
  out.terms = { expected: crit.terms.length, found: crit.terms.length - missingTerms.length, missing: missingTerms };
  return out;
}

/** Totals across many recordings. */
export function summarize(results) {
  const total = { files: results.length, words: 0, errors: 0, rawErrors: 0 };
  const kinds = { numbers: [0, 0], units: [0, 0], medicines: [0, 0], terms: [0, 0] };
  for (const r of results) {
    total.words += r.wer.refLength;
    total.errors += r.wer.distance;
    total.rawErrors += r.rawWer ? r.rawWer.distance : r.wer.distance;
    for (const k of Object.keys(kinds)) {
      kinds[k][0] += r.critical[k].found;
      kinds[k][1] += r.critical[k].expected;
    }
  }
  const pct = (a, b) => (b === 0 ? null : Math.round((a / b) * 1000) / 10);
  return {
    files: total.files,
    wordErrorRate: pct(total.errors, total.words),
    wordErrorRateBeforeCleaning: pct(total.rawErrors, total.words),
    criticalRecall: Object.fromEntries(Object.entries(kinds).map(([k, [f, e]]) => [k, { found: f, expected: e, percent: pct(f, e) }])),
  };
}
