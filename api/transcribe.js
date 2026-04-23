/**
 * api/transcribe.js — Vercel Serverless Function
 *
 * Proxies audio transcription requests to Deepgram Nova 3 Medical.
 * Accepts multipart/form-data with an audio blob, returns transcript text.
 * DEEPGRAM_API_KEY lives in Vercel environment variables — never exposed to client.
 *
 * Security hardening (v10.5.1):
 * - Rate limiting: 20 requests per 60s per IP (matching generate.js pattern)
 * - Audio size cap: 5MB maximum to prevent resource exhaustion
 * - CORS locked to ALLOWED_ORIGIN env var
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

// ─── RATE LIMITER ─────────────────────────────────────────────────────────────

const rateLimitMap = new Map();
const RATE_LIMIT = 20;        // transcription is cheaper than generation, allow slightly more
const RATE_WINDOW = 60 * 1000; // 60 seconds
const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5MB hard cap

function getRealIP(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

  // Rate limit check
  const ip = getRealIP(req);
  if (isRateLimited(ip)) {
    console.warn(`[Handova] Transcribe rate limit exceeded for IP: ${ip}`);
    res.writeHead(429, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Too many requests. Please wait before transcribing again." }));
    return;
  }

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error("[Handova] DEEPGRAM_API_KEY not set in environment variables.");
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Server configuration error. DEEPGRAM_API_KEY is missing." }));
    return;
  }

  try {
    const contentType = req.headers["content-type"] || "";

    if (!contentType.includes("multipart/form-data")) {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Expected multipart/form-data" }));
      return;
    }

    // Buffer incoming body with a hard 5MB size cap
    const chunks = [];
    let totalBytes = 0;

    for await (const chunk of req) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_AUDIO_BYTES) {
        res.writeHead(413, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ error: "Audio file too large. Maximum size is 5MB." }));
        return;
      }
      chunks.push(chunk);
    }

    const rawBody = Buffer.concat(chunks);

    if (rawBody.length < 500) {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Audio too short or empty." }));
      return;
    }

    // Extract boundary from Content-Type header
    const boundaryMatch = contentType.match(/boundary=(.+)$/i);
    if (!boundaryMatch) {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Missing multipart boundary." }));
      return;
    }
    const boundary = boundaryMatch[1].trim();

    // Parse multipart body to find the audio part
    const bodyStr = rawBody.toString("binary");
    const parts = bodyStr.split(`--${boundary}`);

    let audioBuffer = null;
    let audioMime = "audio/webm";

    for (const part of parts) {
      const isAudioField =
        part.includes('name="audio"') ||
        part.includes('name="file"') ||
        part.includes("name=audio") ||
        part.includes("name=file");

      if (isAudioField) {
        const headerBodySplit = part.indexOf("\r\n\r\n");
        if (headerBodySplit === -1) continue;

        const headers = part.substring(0, headerBodySplit);
        const body = part.substring(headerBodySplit + 4);
        const cleanBody = body.replace(/\r\n$/, "");

        const mimeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
        if (mimeMatch) audioMime = mimeMatch[1].trim().split(";")[0];

        audioBuffer = Buffer.from(cleanBody, "binary");
        break;
      }
    }

    if (!audioBuffer || audioBuffer.length < 500) {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "No audio provided or audio too short." }));
      return;
    }

    // Send to Deepgram Nova 3 Medical
    const deepgramRes = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-3-medical&language=en&smart_format=true&punctuate=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
          "Content-Type": audioMime,
        },
        body: audioBuffer,
      }
    );

    if (!deepgramRes.ok) {
      const errData = await deepgramRes.json().catch(() => ({}));
      const errMsg = errData?.err_msg || errData?.message || `Deepgram error ${deepgramRes.status}`;
      console.error("[Handova] Deepgram error:", errMsg);
      throw new Error(errMsg);
    }

    const data = await deepgramRes.json();
    const transcript =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ text: transcript }));

  } catch (err) {
    console.error("[Handova] Transcription error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ error: "Transcription failed: " + err.message }));
  }
}
