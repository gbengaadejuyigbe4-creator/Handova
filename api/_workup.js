/**
 * api/_workup.js
 *
 * Pure functions for the Case Workup (no network, no AI call of their own).
 * The leading underscore keeps Vercel from treating this file as an API route.
 *
 * A workup is a short loop on one patient:
 *   round 1: the AI reads the record and asks the questions whose answers would change the
 *            picture most, for nurses (bedside) and for doctors (history, exam, results)
 *   people answer (or say "unknown" / "not available")
 *   round 2..3: the AI updates the working picture and may ask a few more questions
 *   the last round gives the picture only; it asks nothing more
 *
 * The AI proposes. Code decides what survives. Enforced here, outside the AI:
 *   - Every output is a SUGGESTION: the disclaimer, the notice and "awaiting_medical_review"
 *     are set here and cannot be changed by the AI.
 *   - Every question must be a question (ends with "?"), cite what prompted it, say why it
 *     matters, and not repeat one already asked. Commands are dropped, not rewritten.
 *   - Every suggestion (test, assessment, insight, possibility) must cite a record fact (F),
 *     a record line (R) or a clinician's answer (A). Citations to ids that do not exist are removed.
 *   - Dose and frequency wording that is not copied from the record is dropped.
 *   - Possibilities are always labelled "possible"; wording that states a diagnosis as
 *     established is dropped.
 *   - Test availability (available here / not available / unknown) comes from the hospital's own
 *     list, never from the AI. Anything not on the list is "unknown".
 *   - Free-text answers have the patient's name and phone-like numbers removed.
 *   - Figures that are not in the record or the answers are flagged.
 *   - The patient's name is never sent to the AI.
 *
 * Roles ("nurse" / "doctor") are recorded as given. Until sign-in exists they are self-declared
 * and unverified. Nothing here treats them as proof of identity.
 */

import { findUngroundedNumbers } from "./_flagSafety.js";
import {
  SPECIALIST_DISCLAIMER,
  REVIEW_AWAITING,
  URGENCIES,
  redactName,
  buildSnapshot,
  selectLenses,
  isOrderLikeWording,
} from "./_specialist.js";

export const WORKUP_NOTICE =
  "These are AI-generated suggestions and questions, not a specialist consultation. " +
  "Nothing here is an order. Medical personnel review each one.";

export const AUDIENCES = ["nurse", "doctor"];
export const ROLES = ["nurse", "doctor", "unknown"];
export const QUESTION_KINDS = ["observation", "timing", "history", "exam", "result_lookup"];
export const ANSWER_TYPES = ["yes_no", "number", "choice", "text"];
export const ANSWER_STATUSES = ["answered", "unknown", "not_available"];
export const IMPACTS = ["high", "medium", "low"];
export const AVAILABILITY = ["available", "not_available", "unknown"];

export const MAX_ROUNDS = 3;
export const MAX_OPEN_PER_AUDIENCE = 5;
export const MAX_ITEMS = 5;
export const MAX_UNRESOLVED = 5;
export const MAX_QUESTION_CHARS = 200;
export const MAX_TEXT_CHARS = 300;
export const MAX_ANSWER_CHARS = 300;
export const MAX_CHOICES = 6;

const PRIORITY_RANK = { urgent: 0, soon: 1, routine: 2 };
const IMPACT_RANK = { high: 0, medium: 1, low: 2 };

const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const asArray = (v) => (Array.isArray(v) ? v : []);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------------
// Free text from people: remove names and phone-like numbers, cap the length
// ---------------------------------------------------------------------------------

const PHONE_LIKE = /(?:\+?234|\b0)[789]\d[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;
const LONG_DIGITS = /\b\d{10,}\b/g;

export function scrubFreeText(text, patientName, max = MAX_ANSWER_CHARS) {
  let out = clean(redactName(text, patientName));
  out = out.replace(PHONE_LIKE, "[number removed]").replace(LONG_DIGITS, "[number removed]");
  return out.slice(0, max);
}

// ---------------------------------------------------------------------------------
// Dose and frequency wording that did not come from the record
// ---------------------------------------------------------------------------------

const DOSE_RE = /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|ug|ml|iu|units?)(?:\/(?:kg|day|dose|h|hr|hour|min))?(?![a-z])/gi;
const FREQ_RES = [
  /\b(?:od|bd|tds|qds|qid|tid|bid|prn|stat)\b/gi,
  /\b(?:every|q)\s?\d+\s?(?:h|hr|hrs|hours?|mins?|minutes?)\b/gi,
  /\b\d+\s?(?:times|x)\s?(?:a |per )?(?:day|daily)\b/gi,
];

const normDose = (s) =>
  String(s).toLowerCase().replace(/\s+/g, " ").replace(/(\d)\s(?=[a-zµ])/g, "$1");

/** Dose or frequency expressions in `text` that do not appear in `recordText`. */
export function findUngroundedDosing(text, recordText) {
  const source = String(text || "");
  const record = normDose(recordText || "");
  const found = [];
  for (const re of [DOSE_RE, ...FREQ_RES]) {
    for (const m of source.matchAll(re)) {
      const token = normDose(m[0]);
      if (!record.includes(token) && !found.includes(m[0])) found.push(m[0]);
    }
  }
  return found;
}

// A possibility is something to consider. It must not read as an established diagnosis.
const CERTAINTY_RE = /\b(?:definitely|certainly|undoubtedly|the diagnosis is|diagnosed with|is confirmed|has been confirmed)\b/i;

// ---------------------------------------------------------------------------------
// The hospital's own list of investigations
// ---------------------------------------------------------------------------------

/**
 * list: [{ name, aliases?, status? }]. Status defaults to "unknown".
 * The hospital fills this in. Nothing here guesses what a hospital can run.
 */
export function normalizeCapabilities(list) {
  const out = [];
  for (const raw of asArray(list)) {
    const name = clean(raw?.name);
    if (!name) continue;
    const status = AVAILABILITY.includes(clean(raw?.status)) ? clean(raw.status) : "unknown";
    const aliases = asArray(raw?.aliases).map(clean).filter((a) => a.length >= 2);
    out.push({ name, aliases, status });
  }
  return out;
}

/**
 * Tags a suggested test as available / not_available / unknown from the hospital's list.
 * No match, or matches that disagree, means "unknown".
 */
export function tagAvailability(text, capabilities) {
  const hay = clean(text).toLowerCase();
  if (!hay) return { availability: "unknown", matched: null };
  const statuses = new Set();
  const names = [];
  for (const cap of capabilities || []) {
    const terms = [cap.name, ...(cap.aliases || [])];
    const hit = terms.some((t) => new RegExp(`(?:^|[^a-z0-9])${escapeRe(t.toLowerCase())}(?:$|[^a-z0-9])`).test(hay));
    if (hit) {
      statuses.add(cap.status);
      names.push(cap.name);
    }
  }
  if (statuses.size === 1) return { availability: [...statuses][0], matched: names.join(", ") };
  return { availability: "unknown", matched: statuses.size > 1 ? names.join(", ") : null };
}

// ---------------------------------------------------------------------------------
// Workup state (immutable updates; stored on the device by the app)
// ---------------------------------------------------------------------------------

/** patientRef must be an opaque reference, never a name. */
export function newWorkup(patientRef, now = new Date()) {
  return {
    id: `W-${now.getTime()}`,
    patientRef: clean(patientRef),
    createdAt: now.toISOString(),
    round: 0,
    answersAtLastRound: 0,
    questions: [],
    answers: [],
    picture: null,
  };
}

export const openQuestions = (workup, audience) =>
  workup.questions.filter((q) => q.status === "open" && (!audience || q.audience === audience));

/**
 * Records an answer. Free text is scrubbed here, so a name typed by mistake never reaches
 * the device store or the AI. `by` is a self-declared role until sign-in exists.
 */
export function recordAnswer(workup, { questionId, status = "answered", value = "", by = "unknown", at, patientName = "" }) {
  const q = workup.questions.find((x) => x.id === questionId);
  if (!q) throw new Error("Unknown question.");
  if (q.status !== "open") throw new Error("This question already has an answer.");
  if (!ANSWER_STATUSES.includes(status)) throw new Error("Invalid answer status.");

  const text = scrubFreeText(value, patientName);
  // "answered" with nothing in it is recorded as "unknown" rather than as an empty fact.
  const finalStatus = status === "answered" && !text ? "unknown" : status;
  const answer = {
    id: `A${workup.answers.length + 1}`,
    questionId,
    status: finalStatus,
    value: finalStatus === "answered" ? text : "",
    by: ROLES.includes(by) ? by : "unknown",
    at: at || new Date().toISOString(),
    round: workup.round,
  };
  return {
    ...workup,
    answers: [...workup.answers, answer],
    questions: workup.questions.map((x) => (x.id === questionId ? { ...x, status: finalStatus } : x)),
  };
}

/** Whether another round may run, and if not, why. */
export function canRunRound(workup) {
  if (workup.round >= MAX_ROUNDS) return { ok: false, reason: "max_rounds" };
  if (workup.round >= 1 && workup.answers.length <= workup.answersAtLastRound) {
    return { ok: false, reason: "no_new_answers" };
  }
  return { ok: true, reason: null };
}

/** Merges a normalized result into the workup. Refuses a result from the wrong round. */
export function applyRound(workup, result) {
  if (result.round !== workup.round + 1) throw new Error("This result is not for the next round.");
  return {
    ...workup,
    round: result.round,
    answersAtLastRound: workup.answers.length,
    questions: [...workup.questions, ...result.newQuestions],
    picture: result.picture,
  };
}

// ---------------------------------------------------------------------------------
// Snapshot with clinicians' answers
// ---------------------------------------------------------------------------------

/** Answers as numbered facts A1.., each tied to its question. Free text is scrubbed again. */
export function buildAnswerFacts(workup, patientName = "") {
  return workup.answers.map((a) => {
    const q = workup.questions.find((x) => x.id === a.questionId);
    return {
      id: a.id,
      questionId: a.questionId,
      audience: q?.audience || "nurse",
      question: q?.text || "",
      status: a.status,
      value: a.status === "answered" ? scrubFreeText(a.value, patientName) : "",
      by: a.by,
      at: a.at,
    };
  });
}

export function buildWorkupSnapshot(input = {}, workup, patientName = "") {
  const snapshot = buildSnapshot(input);
  const name = patientName || input.extracted?.name || "";
  const answerFacts = buildAnswerFacts(workup, name);
  const ids = new Set([...snapshot.ids, ...answerFacts.map((a) => a.id)]);
  const answerText = answerFacts.map((a) => `${a.question} ${a.value}`).join("\n");
  return {
    ...snapshot,
    answerFacts,
    ids,
    // Figures a clinician typed in are as valid a source as the record for the "unverified figure" check.
    recordText: `${snapshot.recordText}\n${answerText}`,
  };
}

// ---------------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------------

export function buildWorkupPrompt(snapshot, { workup, lenses, capabilities, questionsAllowed, nextRound }) {
  const facts = snapshot.facts.map((f) => `${f.id} [${f.label}]: ${f.value}`).join("\n") || "(none)";
  const lines = snapshot.lines.map((l) => `${l.id}: ${l.text}`).join("\n") || "(none)";
  const answered = snapshot.answerFacts
    .map((a) => {
      const body = a.status === "answered" ? a.value : a.status === "unknown" ? "(they do not know)" : "(not available)";
      return `${a.id} [${a.audience} question ${a.questionId}] Q: ${a.question} -> ${body}`;
    })
    .join("\n") || "(none yet)";
  const waiting = openQuestions(workup)
    .map((q) => `${q.id} [${q.audience}]: ${q.text}`)
    .join("\n") || "(none)";
  const lensList = lenses.map((l) => `- ${l.label}`).join("\n");
  const caps = (capabilities || []).filter((c) => c.status !== "unknown");
  const capLine = caps.length
    ? caps.map((c) => `${c.name}: ${c.status === "available" ? "available here" : "NOT available here"}`).join("; ")
    : "(the hospital has not listed its investigations)";

  const ask = questionsAllowed
    ? `ROUND ${nextRound} of ${MAX_ROUNDS}. Ask at most ${MAX_OPEN_PER_AUDIENCE} NEW questions for nurses and at most ${MAX_OPEN_PER_AUDIENCE} for doctors, only those whose answer would change the working picture most. Fewer is better. If nothing is worth asking, return an empty list.`
    : `ROUND ${nextRound} of ${MAX_ROUNDS}, the LAST round. Ask NO new questions. Return "questions": [] and give the best working picture from what is known.`;

  return `You are helping clinicians on a Nigerian hospital ward work through a difficult case. You ask the questions a thoughtful colleague would ask, and you write SUGGESTIONS to consider. You are not a specialist consultation, you do not diagnose, and you do not give orders. The clinicians decide everything.

PATIENT RECORD (extracted from a hospital system export; every item is unverified):

FACTS:
${facts}

RECORD LINES:
${lines}

ANSWERS ALREADY GIVEN BY CLINICIANS:
${answered}

QUESTIONS STILL WAITING FOR AN ANSWER (do not ask these again):
${waiting}

AREAS TO THINK THROUGH:
${lensList}

INVESTIGATIONS THE HOSPITAL HAS LISTED: ${capLine}

${ask}

RULES:
1. Every question and every suggestion must cite what it is based on in "basis", using ids that exist above (F1, R3, A2 ...). Never invent an id
2. A question must be a real question that ends with "?". Nurse questions are about the bedside: observations, timing, what changed. Doctor questions are about history, examination findings and results. Use short, plain words
3. Every question needs "why": one short sentence saying what the answer would change. Never ask what the record or an earlier answer already tells you. Never ask for names, phone numbers or other identifiers
4. NUMBERS: copy every value, dose, unit and result exactly as written. Never convert units or calculate new values
5. Do not write doses, frequencies, thresholds, targets or monitoring intervals unless they are copied from the record
6. Language of consideration only: "Consider", "may be worth", "could suggest". Never write commands. Never begin a suggestion with a verb such as give, start, stop, order, prescribe, administer, hold, increase, call or send
7. Do not present a possible diagnosis as established. Put possibilities under "possibilities". Cite what points toward each one in "for" and, where there is something, what points against it in "against"
8. Do not say something was not done merely because it is not in this export. Say "not documented in this export"
9. Suggested tests: name the investigation in "investigation". Do not claim a test is or is not available; the hospital's list decides that
10. Do not repeat an unanswered question. If a clinician said they do not know or it is not available, do not ask it again
11. "unresolved": the few things that still limit the picture. At most ${MAX_UNRESOLVED}
12. At most ${MAX_ITEMS} items per list. One or two sentences each

OUTPUT: valid JSON only, no markdown, in exactly this shape:
{
  "questions": [
    {
      "audience": "nurse | doctor",
      "kind": "observation | timing | history | exam | result_lookup",
      "text": "...?",
      "why": "what the answer would change",
      "answerType": "yes_no | number | choice | text",
      "choices": ["only for choice"],
      "priority": "urgent | soon | routine",
      "impact": "high | medium | low",
      "basis": ["F1"]
    }
  ],
  "picture": {
    "headline": "one short sentence",
    "possibilities": [{"text": "...", "for": ["F2"], "against": []}],
    "tests": [{"investigation": "...", "text": "...", "why": "...", "basis": ["F1"]}],
    "assessments": [{"text": "...", "why": "...", "basis": ["A1"]}],
    "insights": [{"text": "...", "basis": ["F3"]}],
    "unresolved": ["..."],
    "limitations": ["..."]
  }
}`;
}

// ---------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------

function cleanBasis(basis, ids, counters) {
  const kept = [];
  for (const b of asArray(basis)) {
    const id = clean(b);
    if (ids.has(id)) {
      if (!kept.includes(id)) kept.push(id);
    } else if (id) {
      counters.invalidCitations += 1;
    }
  }
  return kept;
}

// Filler words are ignored so that "Has the cough changed?" and "Has the pain changed?" stay different.
const STOP = new Set([
  "the", "and", "any", "has", "have", "had", "was", "were", "did", "does", "can", "could", "there",
  "this", "that", "with", "for", "from", "since", "been", "are", "his", "her", "its", "you", "your",
  "patient", "please", "yet", "still", "now", "today",
]);

const words = (s) =>
  new Set(
    clean(s)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/**
 * True when two questions say nearly the same thing (after ignoring filler words: 70% shared words,
 * or 80% of the shorter question's words when it has at least 4).
 * This catches rewordings, not paraphrases that share few words; the prompt also tells the AI
 * not to repeat a question.
 */
export function similarQuestions(a, b) {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  const smaller = Math.min(x.size, y.size);
  // Also treat a longer question that contains nearly all of a shorter one's words as a repeat,
  // but only once there are enough words (4+) for that to mean something.
  return both / (x.size + y.size - both) >= 0.7 || (smaller >= 4 && both / smaller >= 0.8);
}

function cleanQuestion(raw, ctx, counters) {
  if (!raw || typeof raw !== "object") { counters.invalidQuestions += 1; return null; }
  const audience = clean(raw.audience);
  const text = clean(raw.text).slice(0, MAX_QUESTION_CHARS);
  const why = clean(raw.why).slice(0, MAX_QUESTION_CHARS);
  if (!AUDIENCES.includes(audience) || !text || !why) { counters.invalidQuestions += 1; return null; }
  if (!text.endsWith("?")) { counters.notQuestions += 1; return null; }
  if (isOrderLikeWording(text)) { counters.orderLikeItems += 1; return null; }
  if (findUngroundedDosing(`${text} ${why}`, ctx.snapshot.recordText).length > 0) { counters.dosingRemoved += 1; return null; }
  if (ctx.seenTexts.some((t) => similarQuestions(t, text))) { counters.duplicateQuestions += 1; return null; }

  const basis = cleanBasis(raw.basis, ctx.snapshot.ids, counters);
  if (basis.length === 0) { counters.noBasis += 1; return null; }

  let answerType = ANSWER_TYPES.includes(clean(raw.answerType)) ? clean(raw.answerType) : "text";
  let choices = [];
  if (answerType === "choice") {
    choices = asArray(raw.choices).map((c) => clean(c).slice(0, 40)).filter(Boolean).slice(0, MAX_CHOICES);
    if (choices.length < 2) { answerType = "text"; choices = []; }
  }
  const q = {
    audience,
    kind: QUESTION_KINDS.includes(clean(raw.kind)) ? clean(raw.kind) : audience === "nurse" ? "observation" : "history",
    text,
    why,
    answerType,
    choices,
    priority: URGENCIES.includes(clean(raw.priority)) ? clean(raw.priority) : "routine",
    impact: IMPACTS.includes(clean(raw.impact)) ? clean(raw.impact) : "medium",
    basis,
  };
  const unverified = findUngroundedNumbers(`${text} ${why}`, ctx.snapshot.recordText);
  if (unverified.length > 0) q.unverifiedNumbers = unverified;
  ctx.seenTexts.push(text);
  return q;
}

/** A suggestion (test, assessment, insight) must be worded as consideration, cite its source and carry no invented dosing. */
function cleanSuggestion(raw, ctx, counters) {
  const text = clean(typeof raw === "string" ? raw : raw?.text).slice(0, MAX_TEXT_CHARS);
  if (!text) return null;
  const why = clean(raw?.why).slice(0, MAX_TEXT_CHARS);
  if (isOrderLikeWording(text) || (why && isOrderLikeWording(why))) { counters.orderLikeItems += 1; return null; }
  if (findUngroundedDosing(`${text} ${why}`, ctx.snapshot.recordText).length > 0) { counters.dosingRemoved += 1; return null; }
  const basis = cleanBasis(typeof raw === "object" ? raw.basis : [], ctx.snapshot.ids, counters);
  if (basis.length === 0) { counters.noBasis += 1; return null; }
  const item = { text, basis };
  if (why) item.why = why;
  const unverified = findUngroundedNumbers(`${text} ${why}`, ctx.snapshot.recordText);
  if (unverified.length > 0) item.unverifiedNumbers = unverified;
  return item;
}

function cleanPossibility(raw, ctx, counters) {
  const text = clean(raw?.text).slice(0, MAX_TEXT_CHARS);
  if (!text) return null;
  if (isOrderLikeWording(text)) { counters.orderLikeItems += 1; return null; }
  if (CERTAINTY_RE.test(text)) { counters.certaintyRemoved += 1; return null; }
  if (findUngroundedDosing(text, ctx.snapshot.recordText).length > 0) { counters.dosingRemoved += 1; return null; }
  const forIds = cleanBasis(raw?.for, ctx.snapshot.ids, counters);
  if (forIds.length === 0) { counters.noBasis += 1; return null; }
  const item = { text, for: forIds, against: cleanBasis(raw?.against, ctx.snapshot.ids, counters), certainty: "possible" };
  const unverified = findUngroundedNumbers(text, ctx.snapshot.recordText);
  if (unverified.length > 0) item.unverifiedNumbers = unverified;
  return item;
}

function cleanList(list, fn, ctx, counters) {
  const out = [];
  for (const raw of asArray(list)) {
    const item = fn(raw, ctx, counters);
    if (item) out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/**
 * Validates and labels the AI's reply for the next round. Throws if it is unusable.
 * `now` is injectable so tests are deterministic.
 */
export function normalizeWorkupResult(raw, snapshot, { workup, lenses = [], capabilities = [], now = new Date() }) {
  if (!raw || typeof raw !== "object" || !raw.picture || typeof raw.picture !== "object") {
    throw new Error("AI returned the workup in an unexpected format.");
  }
  const round = workup.round + 1;
  const questionsAllowed = round < MAX_ROUNDS;
  const counters = {
    invalidCitations: 0, invalidQuestions: 0, notQuestions: 0, orderLikeItems: 0,
    dosingRemoved: 0, duplicateQuestions: 0, noBasis: 0, certaintyRemoved: 0,
    askedTooMany: 0, questionsOnLastRound: 0,
  };
  const ctx = { snapshot, seenTexts: workup.questions.map((q) => q.text) };

  // ---- Questions ----
  const candidates = [];
  const rawQuestions = asArray(raw.questions);
  if (!questionsAllowed) {
    counters.questionsOnLastRound = rawQuestions.length;
  } else {
    for (const r of rawQuestions) {
      const q = cleanQuestion(r, ctx, counters);
      if (q) candidates.push(q);
    }
  }
  candidates.sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact],
  );

  const room = Object.fromEntries(AUDIENCES.map((a) => [a, MAX_OPEN_PER_AUDIENCE - openQuestions(workup, a).length]));
  const newQuestions = [];
  for (const q of candidates) {
    if (room[q.audience] <= 0) { counters.askedTooMany += 1; continue; }
    room[q.audience] -= 1;
    newQuestions.push({ ...q, id: `Q${workup.questions.length + newQuestions.length + 1}`, status: "open", round });
  }

  // ---- Picture ----
  const p = raw.picture;
  const tests = cleanList(p.tests, (r, c, k) => {
    const item = cleanSuggestion(r, c, k);
    if (!item) return null;
    const investigation = clean(r?.investigation).slice(0, 80);
    const tag = tagAvailability(investigation || item.text, capabilities);
    return { ...item, investigation, availability: tag.availability, availabilityMatched: tag.matched };
  }, ctx, counters);

  const picture = {
    headline: clean(p.headline).slice(0, 200),
    possibilities: cleanList(p.possibilities, cleanPossibility, ctx, counters),
    tests,
    assessments: cleanList(p.assessments, cleanSuggestion, ctx, counters),
    insights: cleanList(p.insights, cleanSuggestion, ctx, counters),
    unresolved: asArray(p.unresolved)
      .map((u) => clean(typeof u === "string" ? u : u?.text).slice(0, MAX_TEXT_CHARS))
      .filter((u) => u && !isOrderLikeWording(u))
      .slice(0, MAX_UNRESOLVED),
    limitations: [
      ...asArray(p.limitations).map(clean).filter(Boolean).slice(0, 3),
      "Based only on the information in this export and the answers given. Other records may exist.",
    ],
    // Set here, never taken from the AI:
    label: "AI-generated suggestion",
    disclaimer: SPECIALIST_DISCLAIMER,
    reviewStatus: REVIEW_AWAITING,
  };

  return {
    round,
    questionsAllowed,
    newQuestions,
    picture,
    notice: WORKUP_NOTICE,
    disclaimer: SPECIALIST_DISCLAIMER,
    meta: {
      generatedAt: now.toISOString(),
      lenses: lenses.map(({ key, label, reason }) => ({ key, label, reason })),
      factCount: snapshot.facts.length,
      recordLineCount: snapshot.lines.length,
      answerCount: snapshot.answerFacts.length,
      removed: counters,
      patientNameSent: false,
    },
  };
}

// ---------------------------------------------------------------------------------
// One round, end to end (the AI call is injected, so tests can script it)
// ---------------------------------------------------------------------------------

/**
 * input: { extracted, summary, unreviewedResults, filteredText, workup, capabilities, now? }
 * deps:  { ask: async (promptText) => parsedJsonObject }
 * Returns { result, workup } where workup already includes the round.
 */
export async function runWorkupRound(input, deps) {
  const { workup, now } = input;
  const can = canRunRound(workup);
  if (!can.ok) {
    const err = new Error(can.reason === "max_rounds" ? "This workup has used all its rounds." : "Answer at least one new question before updating.");
    err.code = can.reason;
    throw err;
  }
  const capabilities = normalizeCapabilities(input.capabilities);
  const snapshot = buildWorkupSnapshot(input, workup);
  if (snapshot.facts.length === 0 && snapshot.lines.length === 0) throw new Error("The record is empty.");

  const lenses = selectLenses(snapshot);
  const nextRound = workup.round + 1;
  const prompt = buildWorkupPrompt(snapshot, {
    workup, lenses, capabilities, nextRound, questionsAllowed: nextRound < MAX_ROUNDS,
  });
  const raw = await deps.ask(prompt);
  const result = normalizeWorkupResult(raw, snapshot, { workup, lenses, capabilities, now });
  return { result, workup: applyRound(workup, result), prompt };
}
