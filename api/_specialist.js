/**
 * api/_specialist.js
 *
 * Pure functions for the Specialist Perspective pipeline (no network, no AI call).
 * The leading underscore keeps Vercel from treating this file as an API route.
 *
 * The pipeline, in order:
 *   1. buildSnapshot   - turn the extracted record into numbered facts F1.. and record lines R1..
 *   2. selectLenses    - pick at most three specialties from keywords (deterministic, explained)
 *   3. buildPrompt     - the instructions and record sent to the AI
 *   4. normalizeSpecialistResult - strict checks on whatever the AI sent back
 *
 * Principles enforced here, outside the AI:
 *   - Every perspective is a SUGGESTION and carries the disclaimer. The AI cannot change it.
 *   - Every perspective starts as "awaiting_medical_review". The AI cannot change it.
 *   - Citations must point to real facts in the snapshot; others are removed.
 *   - Items worded as orders are removed, not rewritten.
 *   - Evidence gaps must use one of six defined states.
 *   - The patient's name is never sent to the AI.
 */

import { findUngroundedNumbers } from "./_flagSafety.js";

export const SPECIALIST_DISCLAIMER =
  "AI-generated suggestion for the responsible clinician's consideration. " +
  "Not a diagnosis, not an order, and not a substitute for clinical judgment. " +
  "The decision rests with you.";

export const SPECIALIST_NOTICE =
  "These are AI-generated suggestions, not a specialist consultation. " +
  "Nothing here is an order. Medical personnel review each one.";

export const REVIEW_AWAITING = "awaiting_medical_review";

export const GAP_STATES = [
  "not_documented",
  "ordered_not_completed",
  "completed_pending",
  "completed_available",
  "possibly_elsewhere",
  "not_ordered_consider",
];
export const NEXT_STEPS = ["locate_existing", "clarify_record", "complete_ordered", "consider_new"];
export const URGENCIES = ["urgent", "soon", "routine"];

// Is a suggestion already covered by what the doctor has documented?
export const COVERAGE = ["in_plan", "partly_in_plan", "not_in_plan", "unknown"];
const COVERAGE_RANK = { not_in_plan: 0, partly_in_plan: 1, unknown: 2, in_plan: 3 };

const MAX_PERSPECTIVES = 3;
const MAX_ITEMS = 5;
const MAX_GAPS = 4;
const MAX_RECORD_LINES = 60;
const MAX_LINE_CHARS = 240;

const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

// ---------------------------------------------------------------------------------
// 1. Snapshot
// ---------------------------------------------------------------------------------

export function redactName(text, name) {
  let out = String(text || "");
  for (const token of String(name || "").split(/[\s,]+/)) {
    if (token.length < 3) continue;
    const safe = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${safe}\\b`, "gi"), "[name]");
  }
  return out;
}

/**
 * input: { extracted, summary, unreviewedResults, flags, filteredText }
 * The patient's name is NOT included, and is removed from the record lines.
 */
export function buildSnapshot(input = {}) {
  const { extracted = {}, summary = "", unreviewedResults = [], filteredText = "" } = input;
  const name = extracted.name || "";
  const facts = [];
  const add = (label, value, source) => {
    const v = clean(redactName(value, name));
    if (!v) return;
    facts.push({ id: `F${facts.length + 1}`, label, value: v, source, verification: "unverified" });
  };

  const SRC = "extracted from the HMS export";
  add("Age", extracted.age, SRC);
  add("Sex", extracted.gender, SRC);
  add("Current diagnosis", extracted.currentDiagnosis, SRC);
  if (clean(extracted.initialDiagnosis) && clean(extracted.initialDiagnosis) !== clean(extracted.currentDiagnosis)) {
    add("Initial diagnosis", extracted.initialDiagnosis, SRC);
  }
  add("Doctor's plan", extracted.doctorsPlan, SRC);
  add("Medications recorded", extracted.medsAdministered, SRC);

  const v = extracted.vitals || {};
  add("BP", v.bp, "latest vitals " + SRC);
  add("Pulse", v.pulse, "latest vitals " + SRC);
  add("Respiratory rate", v.respRate, "latest vitals " + SRC);
  add("Temperature", v.temp, "latest vitals " + SRC);
  add("SpO2", v.spo2, "latest vitals " + SRC);
  add("Random blood sugar", v.rbs, "latest vitals " + SRC);

  (Array.isArray(unreviewedResults) ? unreviewedResults : []).slice(0, 10).forEach((r, i) => {
    add(`Result awaiting review ${i + 1}`, r, SRC);
  });
  add("AI-written summary of the export", summary, "AI summary, not a verified fact");

  const lines = String(filteredText || "")
    .split(/\r?\n/)
    .map((l) => clean(redactName(l, name)))
    .filter(Boolean)
    .slice(0, MAX_RECORD_LINES)
    .map((text, i) => ({ id: `R${i + 1}`, text: text.slice(0, MAX_LINE_CHARS) }));

  const ids = new Set([...facts.map((f) => f.id), ...lines.map((l) => l.id)]);
  // Only these can show that something is already covered: the doctor's plan, the
  // medications recorded, and the record text itself. A vital sign cannot.
  const coverageIds = new Set([
    ...facts.filter((f) => f.label === "Doctor's plan" || f.label === "Medications recorded").map((f) => f.id),
    ...lines.map((l) => l.id),
  ]);
  const recordText = [...facts.map((f) => f.value), ...lines.map((l) => l.text)].join("\n");
  return { facts, lines, ids, coverageIds, recordText };
}

// ---------------------------------------------------------------------------------
// 2. Specialty lenses
// ---------------------------------------------------------------------------------

const LENSES = [
  { key: "neurology", label: "Neurology", terms: ["encephalopath", "seizure", "stroke", "hemipar", "consciousness", "gcs", "headache", "neurolog", "meningit", "confus", "unresponsive"] },
  { key: "endocrinology", label: "Endocrinology and diabetes", terms: ["diabet", "hyperglyc", "hypoglyc", "insulin", "metformin", "hhs", "dka", "thyroid", "rbs", "glucose", "blood sugar"] },
  { key: "nephrology", label: "Nephrology", terms: ["creatinine", "egfr", "renal", "kidney", "aki", "oligur", "urine output", "urea", "catheter", "dialysis"] },
  { key: "respiratory", label: "Respiratory medicine", terms: ["pneumonia", "pleural", "effusion", "spo2", "oxygen", "copd", "asthma", "cough", "dyspn", "breathless", "tuberc"] },
  { key: "cardiology", label: "Cardiology", terms: ["hypertens", "heart failure", "cardiac", "chest pain", "arrhythm", "irregular", "labetalol", "nifedipine", "furosemide", "atrial", "myocard", "echocardio"] },
  { key: "infectious_disease", label: "Infectious disease", terms: ["sepsis", "malaria", "artesunate", "fever", "antibiotic", "ceftriaxone", "metronidazole", "typhoid", "infection", "parasit", "hiv"] },
  { key: "gastroenterology", label: "Gastroenterology and surgery", terms: ["appendic", "abdom", "melaena", "hematemesis", "haematemesis", "gi bleed", "bowel", "hepat", "liver", "vomit", "peritonit", "laparotomy", "ulcer", "omeprazole"] },
  { key: "haematology", label: "Haematology", terms: ["anaemi", "anemi", "haemoly", "hemoly", "platelet", "pcv", "haemoglobin", "hemoglobin", "transfus", "sickle", "hb"] },
];

const GENERAL = { key: "general_medicine", label: "General medicine", reason: "no specialty-specific terms found in the record" };

function termFound(haystack, term) {
  if (term.length <= 3) return new RegExp(`\\b${term}\\b`).test(haystack);
  return haystack.includes(term);
}

/** Returns up to three lenses, each with the matched terms as the reason. */
export function selectLenses(snapshot) {
  const hay = `${snapshot.recordText || ""}\n${(snapshot.facts || []).map((f) => f.label).join("\n")}`.toLowerCase();
  const scored = LENSES.map((lens, order) => {
    const hits = lens.terms.filter((t) => termFound(hay, t));
    return { lens, order, hits };
  })
    .filter((s) => s.hits.length > 0)
    .sort((a, b) => b.hits.length - a.hits.length || a.order - b.order)
    .slice(0, MAX_PERSPECTIVES)
    .map((s) => ({ key: s.lens.key, label: s.lens.label, reason: `matched: ${s.hits.slice(0, 5).join(", ")}` }));
  return scored.length > 0 ? scored : [GENERAL];
}

// ---------------------------------------------------------------------------------
// 3. Prompt
// ---------------------------------------------------------------------------------

export function buildPrompt(snapshot, lenses) {
  const facts = snapshot.facts.map((f) => `${f.id} [${f.label}]: ${f.value}`).join("\n") || "(none)";
  const lines = snapshot.lines.map((l) => `${l.id}: ${l.text}`).join("\n") || "(none)";
  const lensList = lenses.map((l) => `- ${l.key}: ${l.label}`).join("\n");

  return `You are helping a doctor on a Nigerian hospital ward. You write SUGGESTIONS for the doctor to consider, as a clinician might offer a colleague. You are not a specialist consultation, you do not diagnose, and you do not give orders. The doctor decides everything.

PATIENT RECORD (extracted from a hospital system export; every item is unverified):

FACTS:
${facts}

RECORD LINES:
${lines}

WRITE ONE PERSPECTIVE FOR EACH OF THESE SPECIALTY LENSES (use the key exactly):
${lensList}

RULES:
1. Cite the record. Every statement about this patient must list the ids (F1, R3, ...) it is based on in "basis". General medical knowledge that is not about this patient's record must have an empty "basis"
2. Use only ids that exist above. Never invent an id
3. NUMBERS: copy every value, dose, unit and result exactly as written. Never convert units or calculate new values. If a value or unit looks inconsistent or implausible, say "value or unit unclear, verify against the chart"
4. Language of consideration only: "Consider", "may be worth", "could suggest", "worth asking whether". Never write commands. Never begin an item with a verb such as give, start, stop, order, prescribe, administer, hold, increase or titrate
5. Do not invent thresholds, doses, targets or monitoring intervals. Use a number only if it is in the record
6. Do not present a possible diagnosis as established. Put possibilities under "differentials" and mark certainty as "possible"
7. Do not say something was not done merely because it is not in this export. An export may be incomplete. Say "not documented in this export"
8. Do not mention services, equipment or drugs that may not be available on the ward as if they were available
9. EVIDENCE GAPS: list only the few gaps that matter most for this patient, at most ${MAX_GAPS}. Each gap has a "state", which must be exactly one of:
   - not_documented: nothing in the record about it
   - ordered_not_completed: the record shows it was ordered but not done
   - completed_pending: done, result not yet available
   - completed_available: a result is in the record (cite it in "basis")
   - possibly_elsewhere: could exist in another system or document that this export does not include
   - not_ordered_consider: not ordered, and may be worth the doctor considering
   Do not suggest repeating a test only because its result is missing from the export. Do not assume an old result is current
10. At most ${MAX_ITEMS} items per list. Keep each item to one or two sentences
11. COVERAGE: for every monitoring, management and escalation item, and every evidence gap, add "coverage", exactly one of:
   - in_plan: the doctor's plan or a recorded medication already covers it. You MUST cite the plan fact or record line in "basis"
   - partly_in_plan: partly covered. You MUST cite what covers it in "basis"
   - not_in_plan: nothing in the plan or record covers it. This is the most useful kind: it is what the team may not yet be thinking about
   - unknown: you cannot tell
   Never claim in_plan or partly_in_plan without citing. The plan may exist outside this export, so "not_in_plan" means "not found in this record", not "not planned"

OUTPUT: valid JSON only, no markdown, in exactly this shape:
{
  "perspectives": [
    {
      "specialty": "<lens key>",
      "headline": "one short sentence",
      "interpretations": [{"text": "...", "basis": ["F1"]}],
      "differentials": [{"text": "...", "basis": []}],
      "risks": [{"text": "...", "basis": []}],
      "evidenceGaps": [{
        "missing": "what information appears to be missing",
        "state": "not_documented",
        "why": "why it may matter clinically",
        "limitation": "how its absence limits interpretation",
        "nextStep": "locate_existing | clarify_record | complete_ordered | consider_new",
        "urgency": "urgent | soon | routine",
        "needsClinicianDecision": true,
        "coverage": "not_in_plan | partly_in_plan | in_plan | unknown",
        "basis": []
      }],
      "monitoring": [{"text": "...", "basis": [], "coverage": "not_in_plan"}],
      "management": [{"text": "...", "basis": [], "coverage": "unknown"}],
      "escalation": [{"text": "...", "basis": [], "coverage": "unknown"}],
      "limitations": ["..."]
    }
  ]
}`;
}

// ---------------------------------------------------------------------------------
// 4. Validation
// ---------------------------------------------------------------------------------

const ORDER_START =
  /^\s*(?:please\s+)?(?:administer|give|start|commence|initiate|begin|stop|discontinue|withhold|hold|prescribe|order|increase|decrease|titrate|insert|transfuse|resuscitate|activate|call|send)\b/i;
const ORDER_PHRASE = /\b(?:you must|must be (?:given|started|stopped|done)|should immediately|immediately (?:give|start|administer|stop))\b/i;

/** True if the text reads as an order or command rather than a suggestion. */
export function isOrderLikeWording(text) {
  const t = clean(text);
  return ORDER_START.test(t) || ORDER_PHRASE.test(t);
}

const asArray = (v) => (Array.isArray(v) ? v : []);

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

/** A claim of coverage must cite the plan, the medications or the record text. */
function resolveCoverage(raw, basis, coverageIds, counters) {
  const asked = clean(raw?.coverage);
  let value = COVERAGE.includes(asked) ? asked : "unknown";
  if ((value === "in_plan" || value === "partly_in_plan") && !basis.some((b) => coverageIds.has(b))) {
    value = "unknown";
    counters.coverageDowngraded += 1;
  }
  return value;
}

function cleanItems(list, snapshot, counters, withCoverage = false) {
  const { ids, recordText, coverageIds } = snapshot;
  const out = [];
  for (const raw of asArray(list)) {
    const text = clean(typeof raw === "string" ? raw : raw?.text);
    if (!text) continue;
    if (isOrderLikeWording(text)) { counters.orderLikeItems += 1; continue; }
    const basis = cleanBasis(typeof raw === "object" ? raw?.basis : [], ids, counters);
    const item = { text, basis, grounding: basis.length > 0 ? "record" : "general_knowledge" };
    if (withCoverage) item.coverage = resolveCoverage(typeof raw === "object" ? raw : {}, basis, coverageIds, counters);
    const unverified = findUngroundedNumbers(text, recordText);
    if (unverified.length > 0) item.unverifiedNumbers = unverified;
    out.push(item);
    if (out.length >= MAX_ITEMS) break;
  }
  // Suggestions the plan does not cover come first.
  return withCoverage ? out.sort((a, b) => COVERAGE_RANK[a.coverage] - COVERAGE_RANK[b.coverage]) : out;
}

function cleanGaps(list, snapshot, counters) {
  const { ids, recordText, coverageIds } = snapshot;
  const rank = { urgent: 0, soon: 1, routine: 2 };
  const out = [];
  for (const raw of asArray(list)) {
    if (!raw || typeof raw !== "object") { counters.invalidGaps += 1; continue; }
    const missing = clean(raw.missing);
    const why = clean(raw.why);
    const limitation = clean(raw.limitation);
    let state = clean(raw.state);
    if (!missing || !why || !GAP_STATES.includes(state)) { counters.invalidGaps += 1; continue; }
    if ([missing, why, limitation].some(isOrderLikeWording)) { counters.orderLikeItems += 1; continue; }

    const basis = cleanBasis(raw.basis, ids, counters);
    const gap = {
      missing,
      state,
      why,
      limitation,
      nextStep: NEXT_STEPS.includes(clean(raw.nextStep)) ? clean(raw.nextStep) : "clarify_record",
      urgency: URGENCIES.includes(clean(raw.urgency)) ? clean(raw.urgency) : "routine",
      needsClinicianDecision: raw.needsClinicianDecision !== false,
      basis,
      coverage: resolveCoverage(raw, basis, coverageIds, counters),
    };
    // A result cannot be "available" unless the record actually contains something to point to.
    if (gap.state === "completed_available" && basis.length === 0) {
      gap.state = "not_documented";
      gap.downgradedFrom = "completed_available";
    }
    const unverified = findUngroundedNumbers(`${missing} ${why} ${limitation}`, recordText);
    if (unverified.length > 0) gap.unverifiedNumbers = unverified;
    out.push(gap);
  }
  return out
    .sort((a, b) => rank[a.urgency] - rank[b.urgency] || COVERAGE_RANK[a.coverage] - COVERAGE_RANK[b.coverage])
    .slice(0, MAX_GAPS);
}

/**
 * Validates and labels the AI's reply. Throws if it is not usable.
 * `now` is injectable so tests are deterministic.
 */
export function normalizeSpecialistResult(raw, snapshot, lenses, now = new Date()) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.perspectives)) {
    throw new Error("AI returned perspectives in an unexpected format.");
  }

  const counters = { invalidCitations: 0, orderLikeItems: 0, invalidGaps: 0, droppedPerspectives: 0, coverageDowngraded: 0 };
  const allowed = new Map(lenses.map((l) => [l.key, l]));
  const seen = new Set();
  const perspectives = [];

  for (const p of raw.perspectives) {
    const lens = p && typeof p === "object" ? allowed.get(clean(p.specialty)) : null;
    if (!lens || seen.has(lens.key)) { counters.droppedPerspectives += 1; continue; }

    const sections = {
      interpretations: cleanItems(p.interpretations, snapshot, counters),
      differentials: cleanItems(p.differentials, snapshot, counters),
      risks: cleanItems(p.risks, snapshot, counters),
      evidenceGaps: cleanGaps(p.evidenceGaps, snapshot, counters),
      monitoring: cleanItems(p.monitoring, snapshot, counters, true),
      management: cleanItems(p.management, snapshot, counters, true),
      escalation: cleanItems(p.escalation, snapshot, counters, true),
    };
    const hasContent = Object.values(sections).some((s) => s.length > 0);
    if (!hasContent) { counters.droppedPerspectives += 1; continue; }

    const cited = new Set();
    for (const s of Object.values(sections)) for (const item of s) for (const b of item.basis) cited.add(b);

    const limitations = asArray(p.limitations).map(clean).filter(Boolean).slice(0, 3);
    limitations.push("Based only on the information in this export. Other records may exist.");

    const actionable = [...sections.monitoring, ...sections.management, ...sections.escalation, ...sections.evidenceGaps];
    const notInPlan = actionable.filter((x) => x.coverage === "not_in_plan").length;

    seen.add(lens.key);
    perspectives.push({
      id: `P${perspectives.length + 1}`,
      specialty: lens.key,
      specialtyLabel: lens.label,
      headline: clean(p.headline).slice(0, 200) || `${lens.label} considerations`,
      ...sections,
      limitations,
      citedFactIds: [...cited],
      notInPlanCount: notInPlan,
      // Set here, never taken from the AI:
      label: "AI-generated suggestion",
      disclaimer: SPECIALIST_DISCLAIMER,
      reviewStatus: REVIEW_AWAITING,
    });
    if (perspectives.length >= MAX_PERSPECTIVES) break;
  }

  return {
    perspectives,
    notice: SPECIALIST_NOTICE,
    disclaimer: SPECIALIST_DISCLAIMER,
    meta: {
      generatedAt: now.toISOString(),
      lenses: lenses.map(({ key, label, reason }) => ({ key, label, reason })),
      factCount: snapshot.facts.length,
      recordLineCount: snapshot.lines.length,
      removed: counters,
      patientNameSent: false,
    },
  };
}
