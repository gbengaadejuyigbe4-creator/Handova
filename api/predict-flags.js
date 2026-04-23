/**
 * api/predict-flags.js — Handova v12.5
 *
 * Predictive clinical flags via Gemini 2.0 Flash.
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { gemini, extractJson, corsHeaders, getRealIP, isRateLimited } from "./_groq.js";

function buildFlagsPrompt(extracted, filteredText) {
  const { name, currentDiagnosis, initialDiagnosis, doctorsPlan, medsAdministered, vitals, unreviewedResults, flags, summary } = extracted;

  return `You are a senior Nigerian ward nurse with 15 years of clinical experience. Generate predictive clinical flags for the patient below — specific warnings about what could go wrong this shift, what to watch for, and what to do.

These are NOT generic nursing reminders. They must be derived from THIS patient's specific diagnosis, medications, vitals, and clinical history.

PATIENT CLINICAL RECORD:
Name: ${name || "Unknown"}
Current Diagnosis: ${currentDiagnosis || "Not recorded"}
Initial Diagnosis: ${initialDiagnosis || "Same as current"}
Clinical Summary: ${summary || "Not available"}
Doctor's Plan: ${doctorsPlan || "Not recorded"}
Active Medications: ${medsAdministered || "Not recorded"}
Latest Vitals: BP: ${vitals?.bp || "—"} | Pulse: ${vitals?.pulse || "—"} | Temp: ${vitals?.temp || "—"} | SpO2: ${vitals?.spo2 || "—"} | RBS: ${vitals?.rbs || "—"}
Unreviewed Results: ${unreviewedResults?.length > 0 ? unreviewedResults.join("\n") : "None"}
Clinical Flags: ${flags?.length > 0 ? flags.join("\n") : "None"}
Full HMS Clinical Text: ${(filteredText || "Not available").slice(0, 2000)}

SEVERITY LEVELS:
- CRITICAL — immediate danger, life-threatening if missed
- HIGH — significant risk this shift, requires proactive monitoring
- WATCH — lower urgency but clinically relevant

INSTRUCTIONS:
1. Generate 2 to 5 flags specific to THIS patient's record
2. If patient is stable with no high-risk features, generate 1-2 WATCH flags only
3. Each flag must be traceable to something in the patient's record
4. The "action" field must be specific — exact threshold that triggers escalation

OUTPUT valid JSON only, no markdown:
{
  "flags": [
    {
      "title": "Short title for the flag",
      "detail": "Full clinical reasoning specific to this patient",
      "severity": "CRITICAL | HIGH | WATCH",
      "action": "Specific nursing action and escalation threshold"
    }
  ],
  "overallRisk": "LOW | MODERATE | HIGH | CRITICAL",
  "riskSummary": "One sentence summary of the patient's overall risk profile for this shift"
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

  const { extracted, filteredText } = body;
  if (!extracted) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Missing patient data." }));
    return;
  }

  try {
    console.log(`[Handova Flags] Generating for IP: ${ip}`);
    const text = await gemini(buildFlagsPrompt(extracted, filteredText), { temperature: 0.1, maxOutputTokens: 2000 });
    const result = extractJson(text);
    console.log(`[Handova Flags] Generated ${result?.flags?.length || 0} flags for IP: ${ip}`);
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error("[Handova Flags] Error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Flag generation failed: " + err.message }));
  }
}
