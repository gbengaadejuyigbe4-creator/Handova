/**
 * _groq.js — Shared Groq helper for Handova
 *
 * Drop-in replacement for _gemini.js.
 * Uses model rotation across multiple free Groq models to multiply
 * effective rate limits. Each model has its own RPM/RPD bucket,
 * so rotating between them gives you far more headroom.
 *
 * Models pool (all free tier):
 *   - llama-3.3-70b-versatile   : 30 RPM, 1000 RPD  — primary workhorse
 *   - llama-3.1-8b-instant      : 30 RPM, 14400 RPD — fast, high daily limit
 *   - gemma2-9b-it              : 30 RPM, 14400 RPD — good for structured JSON
 *   - mixtral-8x7b-32768        : 30 RPM, 14400 RPD — large context fallback
 *
 * Rotation strategy:
 *   - Tasks with maxOutputTokens <= 1500 → prefer llama-3.1-8b-instant (fastest)
 *   - Tasks with maxOutputTokens > 1500  → prefer llama-3.3-70b-versatile (smartest)
 *   - On 429 from primary → rotate to next model automatically
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Model pool with metadata
const MODELS = [
  {
    id: "llama-3.3-70b-versatile",
    contextWindow: 128000,
    maxTokens: 32768,
    tier: "smart",   // best for complex clinical reasoning
  },
  {
    id: "llama-3.1-8b-instant",
    contextWindow: 128000,
    maxTokens: 8000,
    tier: "fast",    // best for quick extractions
  },
  {
    id: "gemma2-9b-it",
    contextWindow: 8192,
    maxTokens: 8192,
    tier: "fast",    // good JSON output
  },
  {
    id: "mixtral-8x7b-32768",
    contextWindow: 32768,
    maxTokens: 32768,
    tier: "smart",   // large context fallback
  },
];

// Track per-model 429 cooldowns
const modelCooldowns = new Map();

/**
 * Pick the best available model.
 * Prefers smart models for large outputs, fast models for small ones.
 */
function pickModel(maxOutputTokens = 2000) {
  const now = Date.now();
  const preferTier = maxOutputTokens <= 1500 ? "fast" : "smart";

  // Try preferred tier first, then any available
  const ordered = [
    ...MODELS.filter((m) => m.tier === preferTier),
    ...MODELS.filter((m) => m.tier !== preferTier),
  ];

  for (const model of ordered) {
    const cooldownUntil = modelCooldowns.get(model.id) || 0;
    if (now > cooldownUntil && model.maxTokens >= maxOutputTokens) {
      return model;
    }
  }

  // All models cooling down — return least recently rate-limited
  return ordered.reduce((best, m) => {
    const bCooldown = modelCooldowns.get(best.id) || 0;
    const mCooldown = modelCooldowns.get(m.id) || 0;
    return mCooldown < bCooldown ? m : best;
  });
}

/**
 * Call Groq with automatic model rotation on 429.
 * Maintains the same signature as the old gemini() function.
 *
 * @param {string} prompt
 * @param {object} opts - { temperature, maxOutputTokens, retries }
 * @returns {Promise<string>} - raw text response
 */
export async function gemini(prompt, { temperature = 0.2, maxOutputTokens = 2000, retries = 3 } = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY environment variable is not set.");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const triedModels = new Set();

  for (let attempt = 0; attempt <= retries; attempt++) {
    const model = pickModel(maxOutputTokens);

    if (triedModels.has(model.id) && triedModels.size >= MODELS.length) {
      // Tried everything — wait and retry the best one
      console.log(`[Groq] All models rate-limited. Waiting 10s...`);
      await sleep(10000);
      triedModels.clear();
    }

    triedModels.add(model.id);

    console.log(`[Groq] Attempt ${attempt + 1} using model: ${model.id}`);

    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: Math.min(maxOutputTokens, model.maxTokens),
      }),
    });

    if (res.status === 429) {
      // Get retry-after hint if available (Groq sometimes sends it)
      const retryAfter = parseInt(res.headers.get("retry-after") || "8", 10);
      const cooldownMs = retryAfter * 1000;

      console.log(`[Groq] ${model.id} rate limited — cooling down ${retryAfter}s, rotating model`);
      modelCooldowns.set(model.id, Date.now() + cooldownMs);

      if (attempt < retries) continue;

      throw new Error("All Groq models are rate-limited. Please wait a moment and try again.");
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Groq error ${res.status}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response from Groq.");

    // Reset cooldown for this model on success
    modelCooldowns.delete(model.id);
    return text;
  }
}

/**
 * Extract clean JSON from Groq output.
 * Handles markdown fences, thinking blocks, and preamble text.
 * (Identical to the Gemini version — Groq has similar output patterns.)
 */
export function extractJson(raw) {
  let clean = raw
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/^```json\n?|^```\n?|```$/gm, "")
    .trim();
  try {
    return JSON.parse(clean);
  } catch {
    /* continue */
  }
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      /* continue */
    }
  }
  throw new Error("Could not parse AI response. Please try again.");
}

/**
 * Shared CORS headers
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Shared rate limiter
 */
const rateLimitMap = new Map();

export function getRealIP(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

export function isRateLimited(ip, limit = 15, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > windowMs) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= limit) return true;
  entry.count++;
  return false;
}
