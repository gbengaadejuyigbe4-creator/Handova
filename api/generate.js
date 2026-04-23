/**
 * api/generate.js — Handova v12.5
 *
 * Nurses' note generation via Gemini 2.0 Flash.
 * Replaces Groq llama-3.1-8b-instant.
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { gemini, corsHeaders, getRealIP, isRateLimited } from "./_groq.js";

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
  if (isRateLimited(ip, 20, 60000)) {
    res.writeHead(429, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Too many requests. Please wait a moment before generating again." }));
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Server configuration error." }));
    return;
  }

  let messages;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw new Error("No messages provided");
    }
    messages = body.messages;
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Invalid request format: " + e.message }));
    return;
  }

  try {
    const prompt = messages
      .map(m => m.content?.slice(0, 12000) || "")
      .join("\n\n");

    console.log(`[Handova Generate] Generating note for IP: ${ip}`);

    const text = await gemini(prompt, { temperature: 0.3, maxOutputTokens: 2500 });

    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({
      choices: [{ message: { content: text, role: "assistant" }, finish_reason: "stop" }],
    }));

  } catch (err) {
    console.error("[Handova Generate] Error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Generation failed: " + err.message }));
  }
}
