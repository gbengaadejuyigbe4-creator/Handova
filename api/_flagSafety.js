/**
 * api/_flagSafety.js
 *
 * Checks applied to AI-written risk flags before they reach a nurse.
 * Pure functions, no network. The leading underscore keeps Vercel from treating
 * this file as an API route.
 *
 * These checks do not make a flag clinically correct. They make sure a flag is
 * well-formed, is labelled as an AI draft, never rates the patient lower than
 * the flags themselves, and shows any figure that cannot be found in the record.
 */

const SEVERITIES = ["CRITICAL", "HIGH", "WATCH"];
const RISK_LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
const MAX_FLAGS = 5;

export const FLAG_NOTICE =
  "AI-generated draft. Verify against the patient's chart before acting. " +
  "This is not a validated clinical rule. Escalation thresholds and actions " +
  "follow your unit's protocol.";

const asText = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

// Numbers followed by a time unit ("every 15 minutes", "7-14 days") describe general
// medical timing, not values taken from the record, so they are not checked.
const TIME_UNIT_AFTER = /^\s*(?:-\s*\d+(?:\.\d+)?\s*)?(?:hours?|hrs?|h\b|minutes?|mins?|days?|weeks?|months?|years?|hourly)/i;

function numberKey(token) {
  const n = Number(token);
  return Number.isFinite(n) ? String(n) : token;
}

/**
 * Returns the figures in `text` that do not appear anywhere in `recordText`.
 * Whole numbers below 10, years, and numbers followed by a time unit are ignored.
 */
export function findUngroundedNumbers(text, recordText) {
  const record = new Set();
  for (const m of String(recordText || "").matchAll(/\d+(?:\.\d+)?/g)) {
    record.add(m[0]);
    record.add(numberKey(m[0]));
  }

  const missing = [];
  const source = String(text || "");
  for (const m of source.matchAll(/\d+(?:\.\d+)?/g)) {
    const token = m[0];
    const isDecimal = token.includes(".");
    if (!isDecimal && token.length === 1) continue;
    if (!isDecimal && Number(token) < 10) continue;
    if (!isDecimal && /^(19|20)\d\d$/.test(token)) continue;
    const after = source.slice(m.index + token.length);
    if (TIME_UNIT_AFTER.test(after)) continue;
    if (record.has(token) || record.has(numberKey(token))) continue;
    if (!missing.includes(token)) missing.push(token);
  }
  return missing;
}

/**
 * Validates and tidies the AI's reply. Throws if it is not usable.
 */
export function normalizeFlagsResult(result, recordText = "") {
  if (!result || typeof result !== "object" || !Array.isArray(result.flags)) {
    throw new Error("AI returned flags in an unexpected format.");
  }

  const flags = result.flags
    .filter((f) => f && typeof f === "object" && asText(f.title))
    .slice(0, MAX_FLAGS)
    .map((f) => {
      const severity = SEVERITIES.includes(asText(f.severity).toUpperCase())
        ? asText(f.severity).toUpperCase()
        : "WATCH";
      const flag = {
        title: asText(f.title),
        detail: asText(f.detail),
        severity,
        action: asText(f.action),
      };
      const unverified = findUngroundedNumbers(`${flag.title} ${flag.detail} ${flag.action}`, recordText);
      if (unverified.length > 0) flag.unverifiedNumbers = unverified;
      return flag;
    });

  // The overall rating may never be lower than the most severe flag.
  const floor = flags.some((f) => f.severity === "CRITICAL")
    ? "CRITICAL"
    : flags.some((f) => f.severity === "HIGH")
    ? "HIGH"
    : "LOW";
  const claimed = RISK_LEVELS.includes(asText(result.overallRisk).toUpperCase())
    ? asText(result.overallRisk).toUpperCase()
    : floor;
  const overallRisk = RISK_LEVELS.indexOf(claimed) >= RISK_LEVELS.indexOf(floor) ? claimed : floor;

  return {
    flags,
    overallRisk,
    riskSummary: asText(result.riskSummary),
    aiDraft: true,
    notice: FLAG_NOTICE,
  };
}
