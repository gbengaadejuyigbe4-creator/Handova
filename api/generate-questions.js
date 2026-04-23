/**
 * api/generate-questions.js — Handova v12.5
 *
 * AI shift assessment question generation via Gemini 2.0 Flash.
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { gemini, extractJson, corsHeaders, getRealIP, isRateLimited } from "./_groq.js";

function buildQuestionPrompt(extracted, filteredText) {
  const {
    name, currentDiagnosis, initialDiagnosis,
    doctorsPlan, medsAdministered, vitals,
    unreviewedResults, flags, summary,
  } = extracted;

  return `You are a Nigerian ward nurse with 15 years of clinical experience. A nurse is about to write a shift handover report for the patient below. Generate 6 to 9 highly specific questions that will extract the most clinically important shift events from the outgoing nurse.

PATIENT CLINICAL RECORD:
Name: ${name || "Unknown"}
Current Diagnosis: ${currentDiagnosis || "Not recorded"}
Initial Diagnosis: ${initialDiagnosis || "Same as current"}
Clinical Summary: ${summary || "Not available"}
Doctor's Plan: ${doctorsPlan || "Not recorded"}
Active Medications: ${medsAdministered || "Not recorded"}
Latest Vitals: BP: ${vitals?.bp || "—"} | Pulse: ${vitals?.pulse || "—"} | Temp: ${vitals?.temp || "—"} | SpO2: ${vitals?.spo2 || "—"} | RBS: ${vitals?.rbs || "—"}
Unreviewed Lab Results: ${unreviewedResults?.length > 0 ? unreviewedResults.join("\n") : "None flagged"}
Clinical Flags: ${flags?.length > 0 ? flags.join("\n") : "None flagged"}
Full HMS Clinical Text: ${(filteredText || "Not available").slice(0, 2000)}

RULES:
- Each question must be directly answerable by a nurse who was at the bedside
- Target specific clinical events relevant to THIS patient
- Ask about what happened THIS SHIFT — not what the HMS already shows
- Always add this final question exactly: "Is there anything else significant that happened with this patient this shift that has not been covered above?"

OUTPUT: Return a JSON array of question strings only. No numbering, no markdown, no preamble.
Example: ["question one", "question two", "Is there anything else significant that happened with this patient this shift that has not been covered above?"]`;
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
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Invalid request format." }));
    return;
  }

  const { extracted, filteredText } = body;
  if (!extracted || !filteredText) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Missing clinical data." }));
    return;
  }

  try {
    console.log(`[Handova Questions] Generating for IP: ${ip}`);
    const text = await gemini(buildQuestionPrompt(extracted, filteredText), { temperature: 0.1, maxOutputTokens: 1000 });

    let questions;
    try {
      const clean = text.replace(/^```json\n?|^```\n?|```$/gm, "").trim();
      questions = JSON.parse(clean);
      if (!Array.isArray(questions)) throw new Error("Not an array");
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) questions = JSON.parse(match[0]);
      else throw new Error("Could not parse questions from AI response.");
    }

    const openEnded = "Is there anything else significant that happened with this patient this shift that has not been covered above?";
    const filtered = questions.filter(q => typeof q === "string" && !q.toLowerCase().includes("anything else significant"));
    const final = [...filtered.slice(0, 9), openEnded];

    console.log(`[Handova Questions] Generated ${final.length} questions for IP: ${ip}`);
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ questions: final }));

  } catch (err) {
    console.error("[Handova Questions] Error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Question generation failed: " + err.message }));
  }
}
