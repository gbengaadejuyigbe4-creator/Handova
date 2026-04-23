/**
 * api/plan-shift.js — Handova v12.5
 *
 * Nursing shift care plan via Gemini 2.0 Flash.
 * Drug interaction check + main plan generation — no token limits.
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { gemini, extractJson, corsHeaders, getRealIP, isRateLimited } from "./_groq.js";

// ─── DRUG INTERACTION CHECK ───────────────────────────────────────────────────
async function checkDrugInteractions(allMedications, currentDiagnosis, initialDiagnosis) {
  if (!allMedications || typeof allMedications !== "string" || allMedications.trim().length < 5) return null;

  const prompt = `You are a senior clinical pharmacologist assisting Nigerian ward nurses. Analyse drug safety for this patient.

Patient diagnosis: ${currentDiagnosis || "Unknown"}
Admission diagnosis: ${initialDiagnosis || "Unknown"}
Current medication list:
${allMedications}

STRICT RULES:
- MECHANISM REQUIRED: State exact pharmacological mechanism for every flag
- EVIDENCE STANDARD: Only established clinical interactions — not theoretical
- SEVERITY: Grade as CONTRAINDICATED / MAJOR / MODERATE / MINOR — only include MODERATE and above
- DISEASE-SPECIFIC: Drug-disease flags must be specific to the documented diagnosis
- If no significant interactions exist, return empty arrays — do not manufacture flags

OUTPUT valid JSON only, no markdown, no thinking blocks:
{
  "drugDrugInteractions": [{"drugs": "Drug A + Drug B", "mechanism": "exact mechanism", "clinicalRisk": "consequence for this patient", "severity": "MAJOR | MODERATE", "nursingAction": "specific action"}],
  "drugDiseaseContraindications": [{"drug": "Drug name", "mechanism": "exact mechanism", "clinicalRisk": "specific consequence", "severity": "CONTRAINDICATED | MAJOR | MODERATE", "nursingAction": "what to monitor"}],
  "missingMedications": [{"medication": "expected drug", "reason": "evidence-based reason"}]
}`;

  try {
    const text = await gemini(prompt, { temperature: 0.1, maxOutputTokens: 800 });
    return extractJson(text);
  } catch {
    return null;
  }
}

// ─── PLAN PROMPT ──────────────────────────────────────────────────────────────
function buildPlanPrompt(extracted, filteredText, shiftStart, shiftEnd, currentTime, nurseQueries, drugInteractionResult) {
  // Cap filteredText to prevent Groq TPM overflow on free tier
  const safeFilteredText = filteredText ? filteredText.slice(0, 1200) : "Not available";
  const safeNurseQueries = nurseQueries ? nurseQueries.slice(0, 500) : "No additional notes provided";
  const {
    name, currentDiagnosis, initialDiagnosis,
    doctorsPlan, allMedications, medsAdministered, vitals,
    unreviewedResults, flags, summary,
    prognosisTrend, clinicalTimeline, surgeryName,
  } = extracted;

  function generateTimeSlots(start, end) {
    const slots = [];
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let current = sh * 60 + sm;
    const endMins = eh * 60 + em + (eh < sh ? 24 * 60 : 0);
    while (current <= endMins) {
      const h = Math.floor(current / 60) % 24;
      const m = current % 60;
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      current += 60;
    }
    return slots;
  }

  const timeSlots = shiftStart && shiftEnd ? generateTimeSlots(shiftStart, shiftEnd) : [];
  const timeContext = timeSlots.length > 0
    ? `Shift runs from ${shiftStart} to ${shiftEnd}. Current time: ${currentTime}. Available time slots: ${timeSlots.join(", ")}.`
    : `Current time: ${currentTime}. Generate a general shift plan with approximate times.`;

  // Format drug interaction block
  let drugSafetyBlock = "No significant drug interactions or contraindications detected.";
  if (drugInteractionResult) {
    const parts = [];
    if (drugInteractionResult.drugDrugInteractions?.length > 0) {
      parts.push("DRUG-DRUG INTERACTIONS:\n" + drugInteractionResult.drugDrugInteractions.map(
        i => `⚠ ${i.drugs}: ${i.risk} → Nurse action: ${i.nursingAction}`
      ).join("\n"));
    }
    if (drugInteractionResult.drugDiseaseContraindications?.length > 0) {
      parts.push("DRUG-DISEASE CONTRAINDICATIONS:\n" + drugInteractionResult.drugDiseaseContraindications.map(
        i => `🚨 ${i.drug}: ${i.concern} → Nurse action: ${i.nursingAction}`
      ).join("\n"));
    }
    if (drugInteractionResult.missingMedications?.length > 0) {
      parts.push("POTENTIALLY MISSING MEDICATIONS:\n" + drugInteractionResult.missingMedications.map(
        i => `? ${i.medication}: ${i.reason}`
      ).join("\n"));
    }
    if (parts.length > 0) drugSafetyBlock = parts.join("\n\n");
  }

  const trendEmoji = { IMPROVING: "📈", DETERIORATING: "📉", STATIC: "➡️", UNCERTAIN: "❓" };

  return `You are a senior Nigerian ward nurse with 15 years of clinical experience, trained in evidence-based nursing practice and Nigerian hospital protocols.

Generate a complete, time-structured nursing shift care plan for this patient. The plan must be practical, specific, and evidence-based.

IMPORTANT: This plan is AI-generated to ASSIST the nurse's thinking — not replace it. The nurse has final clinical judgment.

---
SHIFT CONTEXT:
${timeContext}

---
PATIENT OVERVIEW:
Name: ${name || "Unknown"}
Current Diagnosis: ${currentDiagnosis || "Not recorded"}
Initial/Admission Diagnosis: ${initialDiagnosis || "Same as current"}
Surgery (if applicable): ${surgeryName || "None"}
Prognosis Trend: ${trendEmoji[prognosisTrend] || ""} ${prognosisTrend || "UNCERTAIN"}
Clinical Timeline: ${clinicalTimeline || "Not available"}
Clinical Summary: ${summary || "Not available"}

---
DOCTOR'S PLAN:
${doctorsPlan || "Not recorded"}

---
ALL CURRENT MEDICATIONS:
${allMedications || medsAdministered || "Not recorded"}

---
LATEST VITALS:
BP: ${vitals?.bp || "—"} | Pulse: ${vitals?.pulse || "—"} | Temp: ${vitals?.temp || "—"} | SpO2: ${vitals?.spo2 || "—"} | RBS: ${vitals?.rbs || "—"}

---
UNREVIEWED LAB RESULTS:
${unreviewedResults?.length > 0 ? unreviewedResults.join("\n") : "None"}

---
CLINICAL FLAGS:
${flags?.length > 0 ? flags.join("\n") : "None"}

---
⚠ DRUG SAFETY ANALYSIS (AI-generated — nurse must verify):
${drugSafetyBlock}

---
NURSE'S CURRENT STATUS NOTES:
${safeNurseQueries}

---
FULL EMR CONTEXT:
${safeFilteredText}

---
INSTRUCTIONS:

Generate the complete shift care plan with:

1. TIME-STRUCTURED INTERVENTIONS — specific nursing actions for each hour. Include:
   - Medication administration (exact drug, dose, route from doctor's plan)
   - Vital signs monitoring frequency based on clinical stability and prognosis trend
   - Fluid management, IV line checks
   - Patient assessment intervals
   - Positioning, pressure area care if relevant
   - Investigation follow-up
   - Comfort and education measures
   - Documentation requirements
   - For post-op patients: wound assessment, drain output, ambulation
   - For neurological patients: GCS, pupillary response at appropriate intervals
   - For diabetic patients: RBS monitoring schedule
   - For obstetric patients: fetal/maternal monitoring

2. NURSING PRIORITIES — ranked list of the top 5 nursing priorities for this shift, based on diagnosis, prognosis trend, drug safety flags, and clinical state. Each priority should have a brief clinical rationale.

3. ESCALATION TRIGGERS — specific clinical findings that warrant immediate doctor notification for THIS patient.

4. DRUG SAFETY FLAGS — include any significant drug interactions or contraindications from the analysis above. Mark each clearly as AI-generated.

5. END-OF-SHIFT NOTE — 3-4 sentence handover note summarising what was done and what the oncoming nurse must prioritise.

PRIORITY LEVELS:
- URGENT — within 30 minutes
- HIGH — within the hour
- ROUTINE — scheduled
- WATCH — monitor closely, escalate if changes
- PRN — as needed

CATEGORIES: MEDICATION | MONITORING | ASSESSMENT | INVESTIGATION | COMFORT | COMMUNICATION | EDUCATION

OUTPUT RULE:
You MUST critically analyze the clinical situation step-by-step in a <thinking>...</thinking> block first.
In your thinking block:
- Evaluate the patient's deterioration risk based on vitals and timeline
- Decide which actions must be URGENT vs ROUTINE
- Formulate the exact rationale for your nurse priorities

After your thinking block, output valid JSON only, no markdown:

{
  "summary": "2-sentence clinical summary of this patient's priority for this shift",
  "prognosisTrend": "${prognosisTrend || "UNCERTAIN"}",
  "clinicalTimeline": "${clinicalTimeline || ""}",
  "nursePriorities": [
    {
      "rank": 1,
      "priority": "priority description",
      "rationale": "clinical reason"
    }
  ],
  "plan": [
    {
      "time": "08:00",
      "priority": "HIGH",
      "category": "MEDICATION",
      "intervention": "Administer IV Ceftriaxone 1g as prescribed — check IV line patency first",
      "rationale": "Scheduled antibiotic dose. Ensure 12-hourly interval maintained for therapeutic levels."
    }
  ],
  "drugSafetyFlags": [
    {
      "type": "DRUG_DRUG | DRUG_DISEASE | MISSING",
      "flag": "description of the concern",
      "nursingAction": "what to do or monitor",
      "aiGenerated": true
    }
  ],
  "escalationTriggers": [
    "BP drops below 90/60 mmHg or rises above 180/110 mmHg"
  ],
  "endOfShiftNote": "3-4 sentence handover note.",
  "nurseThinkingPrompt": "Based on what you know about this patient that the AI doesn't — what would you add or change about this plan?",
  "dataPrompts": [
    {
      "field": "short name of missing data e.g. Urine output, Recent RBS, Latest temperature",
      "question": "conversational prompt to the nurse e.g. Do you have a urine output reading from the last 4 hours? It would help refine the fluid management plan.",
      "clinicalReason": "why this data would change the plan",
      "priority": "HIGH | MODERATE"
    }
  ]
}`;
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const ip = getRealIP(req);
  if (isRateLimited(ip, 8, 60000)) {
    res.writeHead(429, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Too many requests. Please wait a moment." }));
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Server configuration error." }));
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Invalid request format." }));
    return;
  }

  const { extracted, filteredText, shiftStart, shiftEnd, currentTime, nurseQueries } = body;

  if (!extracted) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Missing patient clinical data." }));
    return;
  }

  try {
    console.log(`[Handova Planner v12.5] Starting for IP: ${ip}`);

    // STEP 1: Drug interaction check
    const allMeds = extracted.allMedications || extracted.medsAdministered || "";
    const drugInteractionResult = await checkDrugInteractions(
      allMeds,
      extracted.currentDiagnosis,
      extracted.initialDiagnosis
    );

    console.log(`[Handova Planner v12.5] Drug check complete — generating plan...`);

    // STEP 2: Generate main plan via Gemini (no token limits)
    const planText = await gemini(
      buildPlanPrompt(extracted, filteredText, shiftStart, shiftEnd, currentTime, nurseQueries, drugInteractionResult),
      { temperature: 0.15, maxOutputTokens: 4000 }
    );

    let plan = extractJson(planText);

    // Ensure drug safety flags are included
    if (!plan.drugSafetyFlags && drugInteractionResult) {
      const flags = [];
      drugInteractionResult.drugDrugInteractions?.forEach(i =>
        flags.push({ type: "DRUG_DRUG", flag: `${i.drugs}: ${i.clinicalRisk}`, nursingAction: i.nursingAction, aiGenerated: true })
      );
      drugInteractionResult.drugDiseaseContraindications?.forEach(i =>
        flags.push({ type: "DRUG_DISEASE", flag: `${i.drug}: ${i.clinicalRisk}`, nursingAction: i.nursingAction, aiGenerated: true })
      );
      drugInteractionResult.missingMedications?.forEach(i =>
        flags.push({ type: "MISSING", flag: `Missing: ${i.medication} — ${i.reason}`, nursingAction: "Flag to medical officer", aiGenerated: true })
      );
      plan.drugSafetyFlags = flags;
    }

    if (!plan.nurseThinkingPrompt) {
      plan.nurseThinkingPrompt = "Based on what you know about this patient that the AI doesn't — what would you add or change about this plan?";
    }

    console.log(`[Handova Planner v12.5] Plan generated — ${plan?.plan?.length || 0} interventions, ${plan?.drugSafetyFlags?.length || 0} drug flags`);

    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify(plan));

  } catch (err) {
    console.error("[Handova Planner v12.5] Error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Plan generation failed: " + err.message }));
  }
}
