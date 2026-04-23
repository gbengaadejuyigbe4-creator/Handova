/**
 * api/shift-update.js — Handova v12.5
 *
 * Mid-shift intelligence engine via Gemini 2.0 Flash.
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { gemini, extractJson, corsHeaders, getRealIP, isRateLimited } from "./_groq.js";

function buildUpdatePrompt(extracted, filteredText, originalPlan, updateHistory, newUpdate, shiftStart, shiftEnd, currentTime) {
  const { name, currentDiagnosis, initialDiagnosis, doctorsPlan, allMedications, medsAdministered, vitals, summary, prognosisTrend, clinicalTimeline, surgeryName } = extracted;

  const allUpdates = [...(updateHistory || []), newUpdate];
  const trajectoryText = allUpdates.map((u, i) => `Update ${i + 1} at ${u.time}:\n${u.text}`).join("\n\n");

  const originalPlanSummary = originalPlan ? `
Original shift summary: ${originalPlan.summary || ""}
Original nursing priorities:
${(originalPlan.nursePriorities || []).map(p => `${p.rank}. ${p.priority}`).join("\n")}
Original plan had ${originalPlan.plan?.length || 0} interventions.
` : "No original plan available.";

  return `You are a senior Nigerian ward nurse operating as a clinical reasoning engine. A nurse has submitted a mid-shift update. Analyze what has changed and revise the care plan.

PATIENT:
Name: ${name || "Unknown"}
Diagnosis: ${currentDiagnosis || "Unknown"}
Admission Diagnosis: ${initialDiagnosis || "Same"}
Surgery: ${surgeryName || "None"}
Prognosis Trend at shift start: ${prognosisTrend || "UNCERTAIN"}
Clinical Timeline: ${clinicalTimeline || "Not available"}
Summary: ${summary || "Not available"}

MEDICATIONS: ${allMedications || medsAdministered || "Not recorded"}
BASELINE VITALS: BP: ${vitals?.bp || "—"} | Pulse: ${vitals?.pulse || "—"} | Temp: ${vitals?.temp || "—"} | SpO2: ${vitals?.spo2 || "—"}
DOCTOR'S PLAN: ${doctorsPlan || "Not recorded"}
ORIGINAL PLAN: ${originalPlanSummary}
EMR CONTEXT: ${(filteredText || "Not available").slice(0, 1000)}

SHIFT UPDATE TRAJECTORY:
${trajectoryText}

CURRENT TIME: ${currentTime}
REMAINING SHIFT: ${currentTime} to ${shiftEnd || "end of shift"}

INSTRUCTIONS:
1. INFER clinical meaning from the updates — do not just restate them
2. COMPARE current state to baseline — what improved, deteriorated, or is new?
3. TRAJECTORY — where is this patient heading based on all updates?
4. ESCALATE — if any update suggests the patient needs immediate doctor review, flag it
5. REVISE — generate updated plan from now to end of shift

OUTPUT valid JSON only, no markdown:
{
  "delta": {
    "changesDetected": ["list of specific clinical changes from baseline"],
    "clinicalMeaning": "clinical inference — not a restatement",
    "trajectory": "IMPROVING | STATIC | DETERIORATING | CRITICAL",
    "trajectoryReasoning": "why you assessed this trajectory"
  },
  "immediateAction": {
    "action": "the single most important thing the nurse must do right now",
    "rationale": "clinical reasoning",
    "timeframe": "within X minutes"
  },
  "escalate": true,
  "escalationReason": "what to tell the doctor and why — empty string if escalate is false",
  "updatedSummary": "2-3 sentence clinical summary of current state",
  "updatedPrognosisTrend": "IMPROVING | DETERIORATING | STATIC | UNCERTAIN",
  "nursePriorities": [{"rank": 1, "priority": "description", "rationale": "reason"}],
  "revisedPlan": [
    {
      "time": "14:00",
      "priority": "URGENT | HIGH | ROUTINE | WATCH | PRN",
      "category": "MEDICATION | MONITORING | ASSESSMENT | INVESTIGATION | COMFORT | COMMUNICATION | EDUCATION",
      "intervention": "specific nursing action",
      "rationale": "clinical reasoning"
    }
  ],
  "updatedEscalationTriggers": ["updated list of specific findings that warrant doctor call"],
  "endOfShiftNote": "updated 3-4 sentence handover note",
  "nurseThinkingPrompt": "Based on what you observed that the AI cannot know — what else should be on this revised plan?"
}`;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, corsHeaders); res.end(); return; }
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const ip = getRealIP(req);
  if (isRateLimited(ip, 10, 60000)) {
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
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders }); res.end(JSON.stringify({ error: "Invalid request format." })); return; }

  const { extracted, filteredText, originalPlan, updateHistory, newUpdate, shiftStart, shiftEnd, currentTime } = body;

  if (!extracted || !newUpdate?.text) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Missing patient data or update text." }));
    return;
  }

  try {
    console.log(`[Handova ShiftUpdate] Processing for IP: ${ip}`);
    const text = await gemini(
      buildUpdatePrompt(extracted, filteredText, originalPlan, updateHistory, newUpdate, shiftStart, shiftEnd, currentTime),
      { temperature: 0.15, maxOutputTokens: 3000 }
    );
    const result = extractJson(text);
    console.log(`[Handova ShiftUpdate] Complete — trajectory: ${result?.delta?.trajectory}, escalate: ${result?.escalate}`);
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error("[Handova ShiftUpdate] Error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Shift update failed: " + err.message }));
  }
}
