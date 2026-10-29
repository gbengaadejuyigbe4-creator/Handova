/**
 * _groq.js — Shared Groq helper for Handova
 *
 * Model rotation across current Groq models. Each model has its own
 * rate-limit bucket, so rotating gives more headroom.
 *
 * NOTE: Groq retired llama-3.3-70b-versatile and llama-3.1-8b-instant on
 * 16 Aug 2026 (mixtral-8x7b-32768 was retired in Mar 2025). The pool below
 * uses Groq's recommended replacements.
 *
 * To change models without editing code, set GROQ_MODELS in Vercel as a
 * comma-separated list, e.g.  openai/gpt-oss-120b,openai/gpt-oss-20b
 * The first entries are treated as "smart", the last as "fast".
 *
 * Rotation strategy:
 *   - maxOutputTokens <= 1500 -> prefer the fast model
 *   - otherwise               -> prefer the smart model
 *   - 429 (rate limit)        -> cool the model down briefly, rotate
 *   - 404 / model gone        -> mark the model dead for 1 hour, rotate
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// gpt-oss models are reasoning models: reasoning tokens count against
// max_tokens, so we ask for low effort and add headroom (see gemini()).
const DEFAULT_MODELS = [
  { id: "openai/gpt-oss-120b", maxTokens: 8192, tier: "smart", reasoning: true },
  { id: "openai/gpt-oss-20b", maxTokens: 8192, tier: "fast", reasoning: true },
  { id: "qwen/qwen3.6-27b", maxTokens: 8192, tier: "smart", reasoning: false },
];

function loadModels() {
  const env = (process.env.GROQ_MODELS || "").trim();
  if (!env) return DEFAULT_MODELS;
  const ids = env.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.map((id, i) => ({
    id,
    maxTokens: 8192,
    tier: i === ids.length - 1 && ids.length > 1 ? "fast" : "smart",
    reasoning: id.startsWith("openai/gpt-oss"),
  }));
}

const MODELS = loadModels();

// Track per-model cooldowns (429s) and dead models (404 / decommissioned)
const modelCooldowns = new Map();
const DEAD_MS = 60 * 60 * 1000;

/**
 * Pick the best available model.
 * Prefers smart models for large outputs, fast models for small ones.
 */
function pickModel(maxOutputTokens = 2000) {
  const now = Date.now();
  const preferTier = maxOutputTokens <= 1500 ? "fast" : "smart";

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

  // All models cooling down — return the one that frees up soonest
  return ordered.reduce((best, m) => {
    const bCooldown = modelCooldowns.get(best.id) || 0;
    const mCooldown = modelCooldowns.get(m.id) || 0;
    return mCooldown < bCooldown ? m : best;
  });
}

function isModelGone(status, err) {
  const code = err?.error?.code || "";
  const msg = (err?.error?.message || "").toLowerCase();
  return (
    status === 404 ||
    code === "model_not_found" ||
    code === "model_decommissioned" ||
    msg.includes("does not exist") ||
    msg.includes("decommissioned")
  );
}

/**
 * Call Groq with automatic model rotation on 429 and on retired models.
 * (Function is still called "gemini" so existing imports keep working.)
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
  let lastError = null;

  // Extra attempts so skipping retired models doesn't eat the retry budget
  for (let attempt = 0; attempt <= retries + MODELS.length; attempt++) {
    const model = pickModel(maxOutputTokens);

    if (triedModels.has(model.id) && triedModels.size >= MODELS.length) {
      console.log(`[Groq] All models unavailable. Waiting 10s...`);
      await sleep(10000);
      triedModels.clear();
    }

    triedModels.add(model.id);
    console.log(`[Groq] Attempt ${attempt + 1} using model: ${model.id}`);

    const body = {
      model: model.id,
      messages: [{ role: "user", content: prompt }],
      temperature,
      // Reasoning models spend part of max_tokens on thinking — add headroom
      max_tokens: Math.min(maxOutputTokens + (model.reasoning ? 2000 : 0), model.maxTokens),
    };
    if (model.reasoning) body.reasoning_effort = "low";

    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "8", 10);
      console.log(`[Groq] ${model.id} rate limited — cooling down ${retryAfter}s, rotating model`);
      modelCooldowns.set(model.id, Date.now() + retryAfter * 1000);
      lastError = new Error("All Groq models are rate-limited. Please wait a moment and try again.");
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const message = err?.error?.message || `Groq error ${res.status}`;

      if (isModelGone(res.status, err)) {
        console.error(`[Groq] ${model.id} is unavailable (${message}) — rotating model`);
        modelCooldowns.set(model.id, Date.now() + DEAD_MS);
        lastError = new Error(message);
        continue;
      }

      throw new Error(message);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      lastError = new Error("Empty response from Groq.");
      continue;
    }

    modelCooldowns.delete(model.id);
    return text;
  }

  throw lastError || new Error("Groq request failed.");
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
