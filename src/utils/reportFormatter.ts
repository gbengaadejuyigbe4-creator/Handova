/**
 * reportFormatter.ts
 *
 * Responsibilities:
 * 1. buildStructuredReport — assembles the complete shift report string
 *    in the selected format (standard, SBAR, ISBAR, SOAP).
 * 2. buildStructuredPrompt — constructs the AI prompt for nurse's note
 *    generation in the selected format.
 * 3. buildRawInputPrompt — Quick Mode prompt for raw text → full report.
 *
 * The prompt engineering here is deliberate:
 * - Scribe identity prevents hallucination (AI told it cannot add clinical detail)
 * - Real examples from actual shift reports calibrate style and length
 * - Arrival context is the single most clinically important variable
 * - Doctor's plan is included only if provided; never invented
 * - Temperature is set to 0.3 server-side to reduce creative deviation
 */

import type { ShiftHeader, Patient } from "../types";
import { getRegionConfig, type Region } from "./regionConfig";

// ─── TYPE ────────────────────────────────────────────────────────────────────

export type ReportFormat = "standard" | "sbar" | "isbar" | "soap";

// ─── FORMAT LABELS ───────────────────────────────────────────────────────────

export const FORMAT_LABELS: Record<ReportFormat, { short: string; long: string }> = {
  standard: { short: "Standard", long: "Clinical narrative" },
  sbar:     { short: "SBAR",     long: "Situation · Background · Assessment · Recommendation" },
  isbar:    { short: "ISBAR",    long: "Identify · Situation · Background · Assessment · Recommendation" },
  soap:     { short: "SOAP",     long: "Subjective · Objective · Assessment · Plan" },
};

// ─── DATE FORMATTING ─────────────────────────────────────────────────────────

/**
 * Converts ISO date string (YYYY-MM-DD from input[type=date])
 * to clinical format DD/MM/YY.
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const [year, month, day] = dateStr.split("-");
  if (!year || !month || !day) return "—";
  return `${day}/${month}/${year.slice(2)}`;
}

// ─── PATIENT FLOW CALCULATION ────────────────────────────────────────────────

/**
 * Calculates patients remaining at handover.
 * Invariant: takenOver + admissions + transfersIn = transfersOut + discharges + dama + deaths + referralsOut + remaining
 */
export function calcRemainingAtHandover(header: ShiftHeader): number {
  const taken = parseInt(header.takenOver) || 0;
  const admissions = parseInt(header.admissions) || 0;
  const transfersIn = parseInt(header.transfersIn) || 0;
  const transfersOut = parseInt(header.transfersOut) || 0;
  const discharges = parseInt(header.discharges) || 0;
  const dama = parseInt(header.dama) || 0;
  const deaths = parseInt(header.deaths) || 0;
  const referralsOut = parseInt(header.referralsOut) || 0;
  return taken + admissions + transfersIn - transfersOut - discharges - dama - deaths - referralsOut;
}

// ─── REPORT ASSEMBLY ─────────────────────────────────────────────────────────

/**
 * Assembles the complete shift report in the requested format.
 * This is the final output that nurses copy into their HMS / EMR.
 */
export function buildStructuredReport(
  header: ShiftHeader,
  patients: Patient[],
  format: ReportFormat = "standard",
  settings?: { nurseName?: string; nurseCredentials?: string; facilityName?: string }
): string {
  const date = formatDate(header.date);
  const shiftUpper = (header.shift || "").toUpperCase();
  const wardUpper = (header.ward || "").toUpperCase();
  const remaining = calcRemainingAtHandover(header);

  let report = "";

  report += `${wardUpper} ${shiftUpper} SHIFT REPORT — ${date}${format === "standard" ? "" : ` (${format.toUpperCase()} FORMAT)`}\n\n`;
  report += `SHIFT PATIENT FLOW\n`;
  report += `Patients Taken Over at Start of Shift: ${header.takenOver || 0}\n`;
  report += `New Admissions During Shift: ${header.admissions || 0}\n`;
  report += `Transfers In During Shift: ${header.transfersIn || 0}\n`;
  report += `Transfers Out to Ward During Shift: ${header.transfersOut || 0}\n`;
  report += `Discharges During Shift: ${header.discharges || 0}\n`;
  report += `DAMA During Shift: ${header.dama || 0}\n`;
  if (parseInt(header.deaths) > 0) report += `Deaths During Shift: ${header.deaths}\n`;
  if (parseInt(header.referralsOut) > 0) report += `Referrals Out During Shift: ${header.referralsOut}\n`;
  report += `Patients at Handover: ${remaining}\n`;

  patients.forEach((p, i) => {
    report += `\n\nINPATIENT ${i + 1}${format === "standard" ? "" : ` — ${format.toUpperCase()}`}\n`;
    if (format !== "standard") report += `${"-".repeat(50)}\n`;

    report += `PATIENT NAME: ${(p.name || "").toUpperCase()}\n`;
    report += `AGE: ${p.age ? p.age + " yrs" : ""}\n`;
    report += `GENDER: ${p.gender || ""}\n`;
    report += `WARD: ${p.ward || ""}\n`;
    report += `BED NUMBER: ${p.bedNumber || ""}\n`;
    report += `ADMISSION DATE: ${formatDate(p.admissionDate)}\n`;
    if (p.dischargeDate) report += `DISCHARGED DATE: ${formatDate(p.dischargeDate)}\n`;
    if (p.initialDiagnosis) report += `INITIAL DIAGNOSIS: ${p.initialDiagnosis}\n`;
    report += `CURRENT DIAGNOSIS: ${p.currentDiagnosis || ""}\n`;
    if (p.investigation) report += `INVESTIGATION: ${p.investigation}\n`;

    report += `\nNURSES' NOTE\n`;
    report += `${p.nursesNoteGenerated || p.nursesNoteRaw || ""}\n`;

    report += `\nFLUID: ${p.fluid || "Nil"}\n`;

    if (p.medsAdministered) {
      report += `\nMEDS ADMINISTERED:\n${p.medsAdministered}\n`;
    }

    const v = p.vitals || {};
    const hasVitals = Object.values(v).some(x => x);
    if (hasVitals) {
      report += `\nVITAL SIGNS AT END OF SHIFT:\n`;
      if (v.bp) report += `BP: ${v.bp.replace(/\s*mmhg$/i, "").trim()} mmHg\n`;
      if (v.pulse) report += `P: ${v.pulse.replace(/\s*bpm$/i, "").trim()} bpm\n`;
      if (v.respRate) report += `R: ${v.respRate.replace(/\s*cpm$/i, "").trim()} cpm\n`;
      if (v.temp) report += `T: ${v.temp.replace(/\s*°?c$/i, "").trim()} °C\n`;
      if (v.spo2) report += `SpO2: ${v.spo2.toString().replace(/%/g, "")}%\n`;
      if (v.rbs) report += `RBS: ${v.rbs}\n`;
    }

    report += `\nCondition at Time of Report: ${p.conditionAtReport || "Stable"}. All necessary nursing care was rendered.\n`;
    report += "\n" + "-".repeat(50);
  });

  const nurseLine = settings?.nurseName
    ? `${settings.nurseName}${settings.nurseCredentials ? ", " + settings.nurseCredentials : ""}`
    : "";
  const facilityLine = settings?.facilityName || "";
  const authorParts = [nurseLine, facilityLine].filter(Boolean).join(" · ");
  report += `\n\n${authorParts ? authorParts + " · " : ""}Generated via Handova · handova.vercel.app`;
  return report;
}

// ─── AI PROMPT BUILDER ───────────────────────────────────────────────────────

/**
 * Builds the AI prompt for nurse's note generation based on the selected format.
 *
 * Supports: standard (narrative), SBAR, ISBAR, SOAP.
 * The format-specific output instructions are injected dynamically.
 */
export function buildStructuredPrompt(
  patient: Patient,
  header: ShiftHeader,
  format: ReportFormat = "standard",
  region: Region = "ng"
): string {
  const shiftTime = header.shift === "Morning" ? "morning"
    : header.shift === "Night/Evening" ? "evening" : header.shift === "Afternoon" ? "afternoon"
    : "night";

  let arrivalContext = "";
  if (!patient.arrivalType || patient.arrivalType === "Taken over at shift start") {
    arrivalContext = `Taken over at the start of the ${shiftTime} shift.`;
  } else if (patient.arrivalType === "Walked in") {
    arrivalContext = `Patient walked into the ward during the ${shiftTime} shift.`;
  } else if (patient.arrivalType === "Rushed in") {
    arrivalContext = `Patient was rushed into the Emergency during the ${shiftTime} shift.`;
  } else if (patient.arrivalType === "From consulting room") {
    arrivalContext = `Patient was referred from the consulting room during the ${shiftTime} shift.`;
  } else if (patient.arrivalType === "Transfer in") {
    arrivalContext = `Patient was received via transfer from ${patient.arrivalFrom || "another facility"} during the ${shiftTime} shift.`;
  } else if (patient.arrivalType === "Other") {
    arrivalContext = `${patient.arrivalOther || "Unspecified arrival"} during the ${shiftTime} shift.`;
  }

  const doctorsPlanSection = patient.doctorsPlan?.trim()
    ? `DOCTOR'S WARD ROUND PLAN:\n${patient.doctorsPlan}`
    : `No doctor ward round this shift.`;

  const regionCfg = getRegionConfig(region);

  // Build contextual data blocks
  const emrContext = patient.emrClinicalText
    ? `FULL HMS CLINICAL RECORD:\n---\n${patient.emrClinicalText}\n---\n`
    : "";

  const answered = (patient.shiftQuestions || []).filter(q => q.answer.trim().length > 0);
  const qnaContext = answered.length > 0
    ? `NURSE'S SHIFT ASSESSMENT — DIRECT Q&A:\n${answered.map(q => `Q: ${q.question}\nA: ${q.answer.trim()}`).join("\n\n")}\n\n`
    : "";

  // Format-specific output instructions
  let formatInstructions = "";

  if (format === "sbar" || format === "isbar") {
    formatInstructions = `OUTPUT FORMAT — Write exactly these labelled sections:\n\n` +
      (format === "isbar" ? `I — IDENTIFICATION\nOne sentence: Patient name, age, gender, ward, bed number.\n\n` : "") +
      `S — SITUATION\nOne to two sentences. State who the patient is, why they are here, and current condition.\n\n` +
      `B — BACKGROUND\nTwo to four sentences. State relevant clinical history, admission context, IV lines, ongoing treatment.\n\n` +
      `A — ASSESSMENT\nThis is the main body. Narrative paragraphs describing everything that happened this shift — interventions, medications given, responses, complaints, doctor review.\n\n` +
      `R — RECOMMENDATION\nTwo to four sentences. State the handover plan, pending actions.\n`;
  } else if (format === "soap") {
    formatInstructions = `OUTPUT FORMAT — Write exactly these four labelled sections:\n\n` +
      `S — SUBJECTIVE\nWhat the patient or family reported during the shift. Include any complaints, stated feelings, or concerns. If the patient had no active complaints, state that.\n\n` +
      `O — OBJECTIVE\nObservable, measurable clinical findings from the shift. Include physical examination findings, vital signs trends, IV access status, wound appearance, intake/output, and any procedures performed. Include medications administered.\n\n` +
      `A — ASSESSMENT\nYour clinical synthesis of the patient's overall condition based on S and O. Include the current working diagnosis, whether the patient is improving/stable/deteriorating, and the doctor's review/plan if applicable.\n\n` +
      `P — PLAN\nThe care plan going forward. Include ongoing treatments, pending investigations, medications to continue, follow-up actions, and any instructions for the oncoming team. If anything is urgently pending, flag it clearly.\n`;
  } else {
    // standard — single flowing narrative paragraph
    formatInstructions = `OUTPUT RULES:\n` +
      `1. ONE PARAGRAPH ONLY. Everything in one continuous flowing paragraph. No line breaks. No sub-paragraphs.\n` +
      `2. Open with the patient's state at takeover/arrival.\n` +
      `3. Weave shift events into chronological flow.\n` +
      `4. Close with patient's state at handover.\n` +
      `5. ${regionCfg.clinicalLanguagePrompt}\n`;
  }

  return `You are a medical scribe generating a hospital nurse's shift note in ${format.toUpperCase()} format for a ${regionCfg.label} clinical setting, following ${regionCfg.compliance} documentation standards.

Your job is to convert the nurse's raw notes into a clean, professional, clinically precise note. You are NOT a clinician — you do not add clinical detail that the nurse did not provide. You only synthesise and reformat.

---

PATIENT CONTEXT:
Arrival: ${arrivalContext}
Name: ${patient.name} | Age: ${patient.age}yrs | Gender: ${patient.gender}
Diagnosis: ${patient.currentDiagnosis}
Ward: ${patient.ward} | Bed: ${patient.bedNumber}
Admission Date: ${patient.admissionDate || "not recorded"}
Initial Diagnosis: ${patient.initialDiagnosis || "same as current"}
Condition at Report: ${patient.conditionAtReport}

${doctorsPlanSection}

${emrContext}${qnaContext}NURSE'S SHIFT NOTES:
${patient.nursesNoteRaw || "Generate from the context above."}

---

${formatInstructions}

ABSOLUTE RULES:
1. Write ONLY what is in the nurse's raw notes or context. Nothing invented.
2. Do not restate the patient's name or age in the body — already in the header.
3. Do not write "All necessary nursing care was rendered" — added automatically.
4. PRESCRIBED BUT NOT GIVEN: If any medication was prescribed but not administered, state this explicitly.
5. URGENCY FLAGS: Any critically pending action — unprocured drugs, unavailable infusions, unreviewed results, deterioration risk — must be clearly flagged beginning with "URGENT:" in caps.
6. MEDICATIONS: Do not list medications by name unless clinically significant. Write "prescribed medications were served and documented" for routine administration.
7. VITALS RULE: Do not put vital sign numbers in the narrative unless part of a critical event timeline. Vitals are reported separately.
8. CLINICAL LANGUAGE: ${regionCfg.clinicalLanguagePrompt}

Before writing the final note, you MUST think clinically in a <thinking>...</thinking> block:
1. What was the exact sequence of events this shift?
2. Are there any discrepancies between the doctor's plan and administered medications?
3. What is the most important finding for the oncoming nurse?

After your <thinking> block, output ONLY the final ${format.toUpperCase()} text.`;
}


// ─── QUICK MODE RAW INPUT PROMPT ─────────────────────────────────────────────

/**
 * buildRawInputPrompt
 *
 * The core of Quick Mode. The nurse dumps everything in one block —
 * messy, unstructured, stream-of-consciousness — and this prompt tells
 * the AI to extract all clinical structure and produce a complete
 * HMS-ready shift report.
 *
 * Design principles:
 * - No required fields. AI extracts what it can, leaves gaps blank.
 * - Multiple patients are auto-detected from context cues (bed numbers,
 *   names, "another patient", "next patient", etc.)
 * - Clinical language is explicitly enforced via region config.
 * - Scribe identity prevents hallucination even in unstructured mode.
 * - Output is the same format as buildStructuredReport — nurses can paste
 *   the result directly into HMS without touching the structured form.
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */
export function buildRawInputPrompt(
  rawText: string,
  format: ReportFormat = "standard",
  settings?: { nurseName?: string; nurseCredentials?: string; facilityName?: string; region?: Region }
): string {
  const regionCfg = getRegionConfig(settings?.region || "ng");

  const authorLine = settings?.nurseName
    ? `${settings.nurseName}${settings.nurseCredentials ? ", " + settings.nurseCredentials : ""}`
    : "";

  const facilityLine = settings?.facilityName || regionCfg.facilityPlaceholder;

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yy = String(today.getFullYear()).slice(2);
  const todayFormatted = `${dd}/${mm}/${yy}`;

  let formatInstructions = "";

  if (format === "sbar" || format === "isbar") {
    formatInstructions = `For each patient's NURSES' NOTE section, use ${format.toUpperCase()} format with clearly labelled sections:
${format === "isbar" ? "I — IDENTIFICATION: Patient name, age, ward, bed number.\n" : ""}S — SITUATION: One to two sentences on who the patient is and current condition.
B — BACKGROUND: Two to three sentences on relevant history, IV lines, ongoing treatment.
A — ASSESSMENT: Two to five paragraphs of flowing clinical narrative of shift events.
R — RECOMMENDATION: Two to three sentences on handover plan and pending actions.
${regionCfg.clinicalLanguagePrompt}`;
  } else if (format === "soap") {
    formatInstructions = `For each patient's NURSES' NOTE section, use SOAP format with clearly labelled sections:
S — SUBJECTIVE: What the patient or family reported. Any complaints or stated feelings.
O — OBJECTIVE: Observable clinical findings, vitals, procedures, medications given.
A — ASSESSMENT: Clinical synthesis of the patient's condition and diagnosis.
P — PLAN: Care plan going forward, pending actions, instructions for oncoming team.
${regionCfg.clinicalLanguagePrompt}`;
  } else {
    formatInstructions = `For each patient's NURSES' NOTE section, write a flowing clinical narrative. Do not use bullet points or headers inside the note — pure paragraphs only.
${regionCfg.clinicalLanguagePrompt}`;
  }

  return `You are a hospital nursing documentation system for ${regionCfg.label}. A nurse has given you unstructured, raw shift handover notes. Your job is to convert these raw notes into a complete, professional shift report following ${regionCfg.compliance} documentation standards.

You are a SCRIBE. You do not add clinical detail. You only reformat and structure what the nurse has told you. If information is missing, leave the field blank — NEVER invent clinical details.

TODAY'S DATE: ${todayFormatted}

---

NURSE'S RAW SHIFT NOTES:
${rawText}

---

EXTRACTION RULES:
1. WARD — Extract from context if mentioned (e.g. "male medical", "female surgical", "A&E"). If not mentioned, write "WARD"
2. SHIFT — Extract if mentioned (Morning/Afternoon/Night). If not clear, write "SHIFT"
3. DATE — Use today's date: ${todayFormatted}
4. PATIENT FLOW — Extract total patients, admissions, discharges, deaths, DAMA if mentioned. Leave as 0 if not mentioned.
5. PATIENTS — Detect each patient from context cues: bed numbers ("bed 4", "bed 7"), patient names, "another patient", numbered mentions, or clear topic shifts. Each gets their own INPATIENT block.
6. PER PATIENT — Extract whatever is available: name/identifier, bed number, diagnosis, vitals, events, doctor review, medications, condition. Leave fields blank if not mentioned.
7. NURSES' NOTE — Write this from the raw notes about that patient. This is the most important field. Write it in a professional clinical nursing narrative style.
8. VITALS — Only include vitals the nurse actually mentioned. Do not estimate or fill in.
9. CONDITION — Infer from context: if nurse said "patient stable", "settled", "doing well" → Stable. "restless", "distressed" → Critical. "improving" → Improving.

${regionCfg.clinicalLanguagePrompt}

${formatInstructions}

---

OUTPUT FORMAT — produce this EXACT structure, no deviations:

[WARD NAME] [SHIFT] SHIFT REPORT — ${todayFormatted}

SHIFT PATIENT FLOW
Patients Taken Over at Start of Shift: [number or 0]
New Admissions During Shift: [number or 0]
Transfers In During Shift: [number or 0]
Transfers Out to Ward During Shift: [number or 0]
Discharges During Shift: [number or 0]
DAMA During Shift: [number or 0]
Patients at Handover: [calculated total]


INPATIENT 1
PATIENT NAME: [NAME IN CAPS or BED X]
AGE: [age] yrs
GENDER: [Male/Female or blank]
WARD: [ward]
BED NUMBER: [bed number or blank]
ADMISSION DATE: [DD/MM/YY or blank]
CURRENT DIAGNOSIS: [diagnosis]

NURSES' NOTE
[Write the nurses' note here using professional clinical narrative style. This must be flowing prose — no bullet points, no headers within the note.]

FLUID: [IV fluid or Nil]

MEDS ADMINISTERED:
[medications if mentioned, or omit this section]

VITAL SIGNS AT END OF SHIFT:
[Only include vitals the nurse mentioned]
BP: [if mentioned]
P: [if mentioned]
R: [if mentioned]
T: [if mentioned]
SpO2: [if mentioned]

Condition at Time of Report: [Stable/Fair/Critical/Improving/Deteriorating]. All necessary nursing care was rendered.

==================================================

[Repeat INPATIENT block for each patient detected. Number them sequentially.]


${authorLine} · ${facilityLine} · Generated via Handova · handova.vercel.app

---

IMPORTANT FINAL CHECKS before outputting:
- Every patient the nurse mentioned has their own INPATIENT block
- No clinical details were invented — only what the nurse said
- The nurses' note uses clinical language appropriate for ${regionCfg.label}
- Vitals section only contains vitals the nurse actually mentioned
- The report is professionally formatted for ${regionCfg.terminology.emrName} entry

Before generating the report, you MUST analyze the raw input in a <thinking>...</thinking> block:
- Identify how many distinct patients are mentioned in the unstructured text.
- Map which vitals and medications belong to which patient.
- Synthesize the sequence of events per patient.

After your <thinking> block, generate the complete requested shift report exactly matching the format.`;
}

/**
 * buildFullReport — alias for buildStructuredReport used by App.tsx for history saving.
 * Uses "standard" format and passes nurse settings for the author line.
 */
export function buildFullReport(
  header: ShiftHeader,
  patients: Patient[],
  settings?: { nurseName?: string; nurseCredentials?: string; facilityName?: string }
): string {
  return buildStructuredReport(header, patients, "standard", settings);
}
