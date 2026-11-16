/**
 * api/specialist.js
 *
 * Specialist Perspective pipeline. Builds a numbered snapshot of the extracted record,
 * picks specialty lenses, asks the AI for suggestions, then validates and labels them.
 *
 * Ships switched OFF: it only runs when the environment variable ENABLE_SPECIALIST is
 * "true". It is not connected to any screen that shows real patient data.
 * Output is decision-support suggestions for a clinician. Never an order.
 */

import { gemini, extractJson, corsHeaders, getRealIP, isRateLimited } from "./_groq.js";
import { buildSnapshot, selectLenses, buildPrompt, normalizeSpecialistResult } from "./_specialist.js";

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, corsHeaders); res.end(); return; }
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  if (process.env.ENABLE_SPECIALIST !== "true") {
    return send(res, 503, { error: "The Specialist pipeline is not enabled." });
  }

  if (isRateLimited(getRealIP(req), 5, 60000)) {
    return send(res, 429, { error: "Too many requests. Please wait." });
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return send(res, 400, { error: "Invalid request body." }); }

  const extracted = body?.extracted;
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) {
    return send(res, 400, { error: "Missing patient record." });
  }

  try {
    const snapshot = buildSnapshot({
      extracted,
      summary: body.summary,
      unreviewedResults: body.unreviewedResults,
      filteredText: typeof body.filteredText === "string" ? body.filteredText.slice(0, 20000) : "",
    });
    if (snapshot.facts.length === 0 && snapshot.lines.length === 0) {
      return send(res, 400, { error: "The record is empty." });
    }

    const lenses = selectLenses(snapshot);
    const text = await gemini(buildPrompt(snapshot, lenses), { temperature: 0.2, maxOutputTokens: 3500 });
    const result = normalizeSpecialistResult(extractJson(text), snapshot, lenses);

    // The snapshot is returned so a screen can show the evidence each citation points to.
    return send(res, 200, { ...result, snapshot: { facts: snapshot.facts, lines: snapshot.lines } });
  } catch (err) {
    console.error("[specialist] failed:", err?.message);
    return send(res, 500, { error: `Specialist pipeline failed: ${err?.message || "unknown error"}` });
  }
}
