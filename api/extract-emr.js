/**
 * api/extract-emr.js — Handova v12.5
 *
 * 3-Stage EMR PDF extraction pipeline:
 *
 * STAGE 1 — PDF → FULL TEXT (no character limit)
 * STAGE 2 — FULL CLINICAL SCAN
 *   - Clinical timeline from day 1
 *   - Surgical shorthand resolution (3DPO → surgery name)
 *   - Prognosis trend detection
 *   - Primary diagnosis from full record
 * STAGE 3 — GEMINI 2.0 FLASH EXTRACTION
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { gemini, extractJson, corsHeaders, getRealIP, isRateLimited } from "./_groq.js";


function resolveSurgicalShorthand(allLines) {
  const dpoPattern = /(\d+)\s*d\/?( po|post.?op)|post.?operative\s*day\s*(\d+)|(\d+)dpo/i;
  const surgeryPattern = /operation|surgery|procedure|laparotomy|c[\/-]?section|caesarean|appendicectomy|colostomy|herniorrhaphy|mastectomy|hysterectomy|oophorectomy|myomectomy|debridement|fasciotomy|craniotomy|burr hole|laminectomy|nephrectomy|cystectomy|thyroidectomy|prostatectomy|amputation|incision|excision|repair|reduction|fixation|arthroplasty|bypass|graft|biopsy|endoscopy|laparoscopy/i;

  let surgeryName = "";
  let dpoDay = "";

  for (let i = 0; i < allLines.length; i++) {
    const match = allLines[i].match(dpoPattern);
    if (match) {
      dpoDay = match[1] || match[3] || match[4] || "";
      for (let j = Math.max(0, i - 1); j >= Math.max(0, i - 60); j--) {
        if (surgeryPattern.test(allLines[j])) {
          surgeryName = allLines[j].trim();
          break;
        }
      }
      if (!surgeryName) {
        for (let j = i + 1; j < Math.min(allLines.length, i + 10); j++) {
          if (surgeryPattern.test(allLines[j])) {
            surgeryName = allLines[j].trim();
            break;
          }
        }
      }
      break;
    }
  }

  return { surgeryName, dpoDay };
}

function detectPrognosisTrend(allLines) {
  const improvingWords = /improv|better|resolv|stable|afebrile|tolerating|ambulating|conscious|alert|responding|discharg|weaning|progress/i;
  const deterioratingWords = /deteriorat|worsen|decline|unresponsive|unconscious|fitting|seizing|septic|shocked|critical|referr|escalat|transfer|death|died|expired|arrest/i;
  const staticWords = /no significant change|unchanged|same|maintained|persist|ongoing|continuing/i;

  let improving = 0;
  let deteriorating = 0;
  let staticCount = 0;

  allLines.forEach((line, idx) => {
    const weight = idx < 30 ? 2 : 1;
    if (improvingWords.test(line)) improving += weight;
    if (deterioratingWords.test(line)) deteriorating += weight;
    if (staticWords.test(line)) staticCount += weight;
  });

  if (deteriorating > improving && deteriorating > staticCount) return "DETERIORATING";
  if (improving > deteriorating * 1.5) return "IMPROVING";
  if (staticCount >= improving && staticCount >= deteriorating) return "STATIC";
  return "UNCERTAIN";
}

function buildClinicalTimeline(allLines) {
  const datePattern = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
  const clinicalEventPattern = /admission|admitted|presented|diagnosis|dx[:\-]|ass[:\-]|assessment|surgery|operation|procedure|transfer|referral|discharge|review|consult|result|finding|complication|deteriorat|improv/i;

  const timelineEntries = [];
  let currentDate = "";

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    if (datePattern.test(line)) currentDate = line.trim();
    if (currentDate && clinicalEventPattern.test(line) && line.length > 10) {
      timelineEntries.push(`[${currentDate}] ${line.trim()}`);
    }
  }

  return [...new Set(timelineEntries)].slice(0, 20).join("\n");
}

function extractPrimaryDiagnosis(allLines) {
  const diagnosisPatterns = [
    /^ass[:\-;]/i,
    /^dx[:\-\u2013]/i,
    /^assessment[:\-]/i,
    /^impression[:\-]/i,
  ];

  const clinicalDxKeywords = /head injury|contusion|fracture|haematoma|subdural|extradural|poisoning|assault|laceration|sepsis|eclampsia|haemorrhage|hemorrhage|infarction|stroke|cva|cvd|pneumonia|appendicitis|peritonitis|meningitis|encephalitis|pancreatitis|cholecystitis|pyelonephritis|cellulitis|malaria|typhoid|hypertension|diabetes|heart failure|renal failure|sickle cell|ectopic|preeclampsia|abruption|obstructed labour|ischaemic|ischemic|pud|gerd|cirrhosis|hepatitis|tuberculosis|hiv|malignancy|cancer|tumour|tumor|abscess|osteomyelitis|burn|polytrauma|rta/i;

  const allDiagLines = [];

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    if (diagnosisPatterns.some(p => p.test(line)) || clinicalDxKeywords.test(line)) {
      const contextLines = allLines.slice(i, Math.min(i + 4, allLines.length));
      allDiagLines.push(...contextLines.map(l => l.trim()));
    }
  }

  return [...new Set(allDiagLines)].slice(0, 20).join("\n");
}

function getRecentClinicalEntries(rawText) {
  const recentText = rawText.length > 18000 ? rawText.slice(0, 18000) : rawText;
  const lines = recentText.split("\n").map(l => l.trim()).filter(l => l.length > 2);

  let inLabBlock = false;
  const taggedLines = [];

  for (const line of lines) {
    if (/^\s*laboratory\s*$/i.test(line) || /INVESTIGATION\s+RESULT/i.test(line)) {
      inLabBlock = true;
    }
    if (/^\s*(drug admin|prescription|vitalsigns|nurse|ward|emergency|consultation|diagnosis|room)\s*$/i.test(line)) {
      inLabBlock = false;
    }
    taggedLines.push(inLabBlock ? `[LAB] ${line}` : line);
  }

  const medicalKeywords = /plan|dx[\-\u2013]|diagnosis|impression|ass:|ass;|ass\-|assessment|result|lab|fbc|pcv|wbc|haemoglobin|\bhb\b|malaria|vital|bp[:\-]|pulse|temp|spo2|resp|treatment|admission|discharge|prescription|administered|iv |tab |cap |inj |mg\b|ml\b|mmol|mmhg|ward|bed|transfer|referral|review|complaint|finding|abnormal|positive|negative|pending|investigation|consult|fluid|infusion|transfusion|oxygen|urinalysis|xray|scan|ecg|\[lab\]/i;
  const dateTimePattern = /\b(mon|tue|wed|thu|fri|sat|sun)\b|\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}:\d{2}\s*(am|pm)/i;

  return taggedLines
    .filter(line => medicalKeywords.test(line) || dateTimePattern.test(line))
    .slice(0, 80)
    .join("\n");
}

function buildFullClinicalContext(rawText) {
  const allLines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 2);

  const primaryDiagBlock = extractPrimaryDiagnosis(allLines);
  const timeline = buildClinicalTimeline(allLines);
  const { surgeryName, dpoDay } = resolveSurgicalShorthand(allLines);
  const prognosisTrend = detectPrognosisTrend(allLines);
  const recentEntries = getRecentClinicalEntries(rawText);

  let context = "";

  if (timeline) {
    context += `[CLINICAL TIMELINE from day 1]:\n${timeline}\n---\n`;
  }

  if (primaryDiagBlock) {
    context += `[PRIMARY DIAGNOSIS SCAN from full record]:\n${primaryDiagBlock}\n---\n`;
  }

  if (surgeryName) {
    context += `[SURGICAL HISTORY resolved]:\nSurgery: ${surgeryName}${dpoDay ? ` | Post-op Day: ${dpoDay}` : ""}\n---\n`;
  }

  context += `[PROGNOSIS TREND detected from full record]: ${prognosisTrend}\n---\n`;
  context += `[RECENT ENTRIES newest first]:\n${recentEntries}`;

  return { context, prognosisTrend, surgeryName, dpoDay };
}

function buildExtractionPrompt(context, prognosisTrend, surgeryName) {
  return `You are a clinical data extraction assistant for Handova, a Nigerian hospital nursing documentation system.

The context below was built from a patient's COMPLETE EMR history from Medikal HMS Nigeria. It includes:
- Clinical timeline from day 1 of admission
- All diagnosis lines from the full record
- Resolved surgical history if applicable
- Pre-detected prognosis trend
- Recent entries for vitals, plan, and medications

YOUR ROLE: Extract structured clinical information. You are a SCRIBE — never invent.

CLINICAL CONTEXT:
---
${context}
---

RULES:
1. PRIMARY DIAGNOSIS — from [PRIMARY DIAGNOSIS SCAN] block — what the patient came in with originally.
2. CURRENT DIAGNOSIS — most recent Dx- or Ass: from [RECENT ENTRIES]. If post-op patient (3DPO etc), use [SURGICAL HISTORY] to name the actual surgery.
3. PROGNOSIS TREND — use pre-detected value: "${prognosisTrend}" unless strong contradiction exists.
4. SURGERY — if [SURGICAL HISTORY] present, include surgery name and post-op day.
5. DOCTOR'S PLAN — verbatim from most recent consultation in [RECENT ENTRIES].
6. VITALS — most recent Vitalsigns entry only.
7. UNREVIEWED LAB RESULTS — only [LAB] lines appearing AFTER the most recent consultation.
8. ALL MEDICATIONS — extract every current prescribed medication from plan and Drug Admin.
9. Never use "Nil..." lines as a diagnosis. Never guess. Empty string "" for missing fields.

OUTPUT valid JSON only, no markdown:

{
  "name": "PATIENT FULL NAME IN CAPS",
  "age": "age as string",
  "gender": "Male or Female",
  "ward": "current ward",
  "bedNumber": "bed number",
  "admissionDate": "YYYY-MM-DD",
  "initialDiagnosis": "day 1 admission diagnosis from [PRIMARY DIAGNOSIS SCAN] or [CLINICAL TIMELINE]",
  "currentDiagnosis": "most recent working diagnosis. If post-op, include surgery name and post-op day.",
  "surgeryName": "${surgeryName || ""}",
  "prognosisTrend": "${prognosisTrend}",
  "clinicalTimeline": "2-3 sentence narrative of patient journey from admission to now",
  "doctorsPlan": "most recent plan verbatim",
  "allMedications": "complete current medication list — drug name, dose, frequency, one per line",
  "medsAdministered": "confirmed administered meds from Drug Admin, one per line",
  "vitals": {
    "bp": "",
    "pulse": "",
    "respRate": "",
    "temp": "",
    "spo2": "",
    "rbs": ""
  },
  "unreviewedResults": ["[LAB] entries after most recent consultation only"],
  "flags": ["critically abnormal values or urgent findings"],
  "summary": "3-4 sentence clinical summary of current state, trajectory, and shift priority"
}`;
}

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
  if (isRateLimited(ip)) {
    res.writeHead(429, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Too many extraction requests. Please wait a moment." }));
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

  const { document, documents, rawText: incomingText } = body;
  
  const docs = documents || (document ? [document] : []);

  // ── PLAIN TEXT PATH ──────────────────────────────────────────────────────────
  if (incomingText) {
    if (typeof incomingText !== "string" || incomingText.trim().length < 30) {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Text input too short. Please provide more clinical detail." }));
      return;
    }

    try {
      console.log(`[Handova EMR v12] Text input path — ${incomingText.length} chars for IP: ${ip}`);

      // For typed/pasted text, bypass the HMS PDF pipeline entirely.
      // The nurse has typed free-form clinical notes — send them directly to Groq
      // with a lightweight extraction prompt. No date-pattern filtering needed.
      const textPrompt = `You are a clinical data extraction assistant for Handova, a Nigerian hospital nursing documentation system.

A nurse has typed or pasted the following clinical notes about a patient. Extract all available information into structured JSON.

CLINICAL TEXT:
---
${incomingText.trim().slice(0, 4000)}
---

RULES:
- Extract ONLY what is explicitly stated. Never invent or infer beyond what is written.
- For any field not present in the text, use an empty string "".
- currentDiagnosis: the working diagnosis or assessment stated.
- doctorsPlan: any plan, orders, or instructions mentioned.
- allMedications/medsAdministered: any drugs, doses, or routes mentioned.
- vitals: any BP, pulse, temperature, SpO2, RBS values mentioned.
- summary: write a 2-3 sentence clinical summary of what the text describes.

OUTPUT valid JSON only — no markdown, no preamble, no thinking block:

{
  "name": "",
  "age": "",
  "gender": "Male or Female or empty string",
  "ward": "",
  "bedNumber": "",
  "admissionDate": "",
  "initialDiagnosis": "",
  "currentDiagnosis": "",
  "surgeryName": "",
  "prognosisTrend": "IMPROVING or DETERIORATING or STATIC or UNCERTAIN",
  "clinicalTimeline": "",
  "doctorsPlan": "",
  "allMedications": "",
  "medsAdministered": "",
  "vitals": { "bp": "", "pulse": "", "respRate": "", "temp": "", "spo2": "", "rbs": "" },
  "unreviewedResults": [],
  "flags": [],
  "summary": ""
}`;

      const rawContent = await gemini(textPrompt, { temperature: 0.1, maxOutputTokens: 1500 });
      let content = rawContent;

      // Strip thinking blocks, markdown fences, preamble
      content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
      content = content.replace(/^```json\n?|^```\n?|```$/gm, "").trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) content = jsonMatch[0];
      try { JSON.parse(content); } catch {
        throw new Error("AI returned unreadable data. Please try again.");
      }

      res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({
        choices: [{ message: { content, role: "assistant" }, finish_reason: "stop" }],
        filteredText: incomingText.trim(),
        prognosisTrend: "UNCERTAIN",
        surgeryName: "",
        dpoDay: "",
      }));
      return;
    } catch (err) {
      console.error("[Handova EMR v12.5] Text path error:", err.message);
      res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Extraction failed: " + err.message }));
      return;
    }
  }

  // ── PDF / IMAGE PATH ─────────────────────────────────────────────────────────────────
  if (docs.length === 0 || !docs[0].data || !docs[0].mediaType) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Missing document data." }));
    return;
  }

  const hasImage = docs.some(d => d.mediaType.startsWith("image/"));
  const hasPDF = docs.some(d => d.mediaType === "application/pdf");

  if (hasPDF && docs.length > 1) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Only one PDF can be processed at a time. Multiple images are allowed." }));
    return;
  }

  const totalSize = docs.reduce((acc, d) => acc + (d.data?.length || 0), 0);
  if (totalSize > 28 * 1024 * 1024) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Total file size too large. Maximum 20MB." }));
    return;
  }

  try {
    let rawText = "";

    if (hasImage) {
      console.log(`[Handova EMR v12.5] Stage 1 — Image OCR via Gemini Vision for IP: ${ip}`);

      // Gemini vision: send images as inline_data parts
      const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`;
      const parts = [
        { text: "Transcribe all clinical text shown in these images exactly as written. Combine everything logically. Output raw text only — no comments, no formatting." }
      ];
      for (const d of docs) {
        if (d.mediaType.startsWith("image/")) {
          parts.push({ inline_data: { mime_type: d.mediaType, data: d.data } });
        }
      }

      const visionRes = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 3000 },
        }),
      });

      if (!visionRes.ok) {
        const errData = await visionRes.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `Gemini Vision error ${visionRes.status}`);
      }

      const visionData = await visionRes.json();
      rawText = visionData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      console.log(`[Handova EMR v12.5] Stage 1 — full PDF parse for IP: ${ip}`);
      const pdfBuffer = Buffer.from(docs[0].data, "base64");
      const parsed = await pdfParse(pdfBuffer);
      rawText = parsed.text;
    }

    if (!rawText || rawText.trim().length < 50) {
      throw new Error("Could not extract text from this document. Please ensure it is readable and contains clinical data.");
    }

    console.log(`[Handova EMR v12.5] ${rawText.length} chars extracted — running full clinical scan`);

    const { context, prognosisTrend, surgeryName, dpoDay } = buildFullClinicalContext(rawText);

    console.log(`[Handova EMR v12.5] Context built — trend: ${prognosisTrend}, surgery: ${surgeryName || "none"}`);

    const rawContent = await gemini(
      buildExtractionPrompt(context, prognosisTrend, surgeryName),
      { temperature: 0.1, maxOutputTokens: 2000 }
    );

    // Clean the response
    let content = rawContent
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .replace(/^```json\n?|^```\n?|```$/gm, "")
      .trim();
    const jm = content.match(/\{[\s\S]*\}/);
    if (jm) content = jm[0];
    try { JSON.parse(content); } catch { throw new Error("AI returned unreadable data. Please try again."); }

    if (!content) throw new Error("Empty response from AI.");

    console.log(`[Handova EMR v12.5] Extraction complete for IP: ${ip}`);

    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({
      choices: [{ message: { content, role: "assistant" }, finish_reason: "stop" }],
      filteredText: context,
      prognosisTrend,
      surgeryName,
      dpoDay,
    }));

  } catch (err) {
    console.error("[Handova EMR v12] Error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Extraction failed: " + err.message }));
  }
}
