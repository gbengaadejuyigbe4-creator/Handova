/**
 * api/handover-brief.js — Handova v12.5
 *
 * Risk-stratified handover brief via Gemini 2.0 Flash.
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { gemini, extractJson, corsHeaders, getRealIP, isRateLimited } from "./_groq.js";

function buildBriefPrompt(patients, shiftStart, shiftEnd, nurseCount, totalPatients) {
  const patientSummaries = patients.map((p, i) => `
PATIENT ${i + 1}: ${p.name || "Unknown"}
Diagnosis: ${p.diagnosis || "Not recorded"}
Plan summary: ${p.planSummary || "No plan generated"}
Flags: ${p.flags?.length > 0 ? p.flags.map(f => f.title).join(", ") : "None"}
Overall risk: ${p.overallRisk || "Unknown"}
End of shift note: ${p.endOfShiftNote || "Not generated"}
Checked interventions: ${p.checkedCount || 0} of ${p.totalCount || 0} completed
`).join("\n---\n");

  return `You are a senior charge nurse preparing a handover brief. Brief the oncoming team on where to focus first.

SHIFT CONTEXT:
Shift: ${shiftStart || "—"} to ${shiftEnd || "—"}
Nurses on duty: ${nurseCount || "Not specified"}
Total ward patients: ${totalPatients || "Not specified"}
Patients with care plans: ${patients.length}

PATIENT SUMMARIES:
${patientSummaries}

RANKING SYSTEM:
- 🔴 IMMEDIATE — action required within 15 minutes. Life-threatening if delayed.
- 🟠 HIGH — action required within first hour. Significant clinical risk.
- 🟡 WATCH — monitoring priority. No immediate action but close observation needed.
- 🟢 STABLE — routine care. No flags.

For each patient provide: their rank, ONE specific first action, ONE clinical reason why, any pending items.

OUTPUT valid JSON only, no markdown:
{
  "brief": [
    {
      "patientName": "Patient name",
      "priority": "IMMEDIATE | HIGH | WATCH | STABLE",
      "emoji": "🔴 | 🟠 | 🟡 | 🟢",
      "firstAction": "Specific first action for oncoming nurse",
      "clinicalReason": "Why this matters for this specific patient",
      "pending": "Any incomplete interventions — empty string if none"
    }
  ],
  "wardOverview": "2-sentence summary of the overall ward state this shift",
  "mostImportant": "The single most critical thing the oncoming team must know",
  "shiftComplexity": "LOW | MODERATE | HIGH | CRITICAL"
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
  if (isRateLimited(ip, 8, 60000)) {
    res.writeHead(429, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Too many requests. Please wait." }));
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

  const { patients, shiftStart, shiftEnd, nurseCount, totalPatients } = body;
  if (!patients || patients.length < 1) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "At least one patient required." }));
    return;
  }

  try {
    console.log(`[Handova Brief] Generating for ${patients.length} patients, IP: ${ip}`);
    const text = await gemini(buildBriefPrompt(patients, shiftStart, shiftEnd, nurseCount, totalPatients), { temperature: 0.15, maxOutputTokens: 2500 });
    const result = extractJson(text);
    console.log(`[Handova Brief] Complete for IP: ${ip}`);
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error("[Handova Brief] Error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Brief generation failed: " + err.message }));
  }
}
