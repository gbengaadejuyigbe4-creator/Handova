/**
 * api/_auth.js
 *
 * The server guard. Every API route calls guard() right after its method check, before any
 * work and before any AI call. The leading underscore keeps Vercel from treating this file
 * as an API route.
 *
 * It stays OFF until the environment variable AUTH_ENFORCED is set to "true". While it is off,
 * guard() returns true at once and makes no network call, so the app behaves exactly as before.
 *
 * When it is on, a request is let through only if ALL of these hold, checked in this order:
 *   1. It carries a sign-in token, and Supabase confirms the token is genuine and current.
 *   2. The person has a profile that is active, verified, and not waiting to change a
 *      temporary password.
 *   3. Their role is allowed on this route.
 *   4. Doctors and admins signed in with their authenticator-app code (an "aal2" session).
 *   5. They are within their request limit for this route.
 * A known person who is turned away, and every allowed call, is written to the audit log.
 * Requests with no valid token are NOT written there, so a stranger cannot fill the log.
 *
 * Roles come only from the database (the profiles table). Nothing the browser sends can raise one.
 *
 * The audit log holds who, what route, when and the outcome. Never a name, never clinical text.
 */

import { corsHeaders } from "./_groq.js";

export const PATIENT_ROLES = ["nurse", "nurse_in_charge", "doctor"];
export const ADMIN_ROLES = ["admin"];
export const MFA_ROLES = ["doctor", "admin"];

// Placeholder: requests per person, per route, per hour. Adjust with RATE_LIMIT_PER_HOUR.
export const DEFAULT_LIMIT_PER_HOUR = 120;
export const WINDOW_SECONDS = 3600;
const TIMEOUT_MS = 8000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const patientRoute = (route) => ({ route, roles: PATIENT_ROLES });
export const adminRoute = (route) => ({ route, roles: ADMIN_ROLES });

const MESSAGES = {
  sign_in_required: "Please sign in to continue.",
  invalid_token: "Your session has expired. Please sign in again.",
  auth_unavailable: "Sign-in could not be checked right now. Please try again in a moment.",
  server_misconfigured: "Server configuration error.",
  account_not_found: "This account is not set up for Handova. Please contact your administrator.",
  account_inactive: "This account is not active. Please contact your administrator.",
  account_unverified: "This account has not been verified yet. Please contact your administrator.",
  password_change_required: "Please set a new password before continuing.",
  role_not_allowed: "Your role cannot use this feature.",
  mfa_required: "Please confirm with your authenticator app to continue.",
  rate_limited: "Too many requests. Please wait a while before trying again.",
};

const STATUS = {
  sign_in_required: 401,
  invalid_token: 401,
  auth_unavailable: 503,
  server_misconfigured: 500,
  account_not_found: 403,
  account_inactive: 403,
  account_unverified: 403,
  password_change_required: 403,
  role_not_allowed: 403,
  mfa_required: 403,
  rate_limited: 429,
};

const deny = (code, extra = {}) => ({
  allowed: false,
  enforced: true,
  code,
  status: STATUS[code],
  error: MESSAGES[code],
  ...extra,
});

export const isEnforced = (env = process.env) => String(env.AUTH_ENFORCED || "").trim().toLowerCase() === "true";

/** Reads the claims of a token that Supabase has already confirmed. Never used to trust an unchecked token. */
export function readClaims(token) {
  try {
    const part = String(token).split(".")[1];
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) || {};
  } catch {
    return {};
  }
}

function bearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(String(header));
  return match ? match[1] : "";
}

async function call(fetchFn, url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function writeAudit(fetchFn, cfg, row) {
  try {
    await call(fetchFn, `${cfg.url}/rest/v1/audit_log`, {
      method: "POST",
      headers: { apikey: cfg.secret, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  } catch (err) {
    // A failed audit write never blocks a clinician. It is logged on the server for follow-up.
    console.error("[Handova] audit write failed:", err?.message || err);
  }
}

/**
 * Decides whether a request may proceed.
 * policy: { route, roles: [...], limitPerHour? }
 * deps (for tests): { fetch, env }
 */
export async function authenticate(req, policy, deps = {}) {
  const env = deps.env || process.env;
  if (!isEnforced(env)) return { allowed: true, enforced: false };

  const fetchFn = deps.fetch || globalThis.fetch;
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const secret = env.SUPABASE_SECRET_KEY || "";
  const publishable = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || secret;
  if (!url || !secret) return deny("server_misconfigured");
  const cfg = { url, secret };

  // 1. A token, confirmed by Supabase
  const token = bearerToken(req);
  if (!token) return deny("sign_in_required");

  let userId;
  try {
    const res = await call(fetchFn, `${url}/auth/v1/user`, {
      method: "GET",
      headers: { apikey: publishable, Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) return deny("invalid_token");
    if (!res.ok) return deny("auth_unavailable");
    const user = await res.json();
    if (!user || typeof user.id !== "string" || !UUID.test(user.id)) return deny("invalid_token");
    userId = user.id;
  } catch {
    return deny("auth_unavailable");
  }
  const claims = readClaims(token);

  // 2. The person's profile (read with the server's secret key, never with the person's token)
  let profile;
  try {
    const res = await call(
      fetchFn,
      `${url}/rest/v1/profiles?id=eq.${userId}&select=role,active,verified,must_change_password&limit=1`,
      { method: "GET", headers: { apikey: secret, Accept: "application/json" } },
    );
    if (!res.ok) return deny("auth_unavailable");
    const rows = await res.json();
    profile = Array.isArray(rows) ? rows[0] : null;
  } catch {
    return deny("auth_unavailable");
  }

  const refuse = async (code) => {
    if (profile?.role) {
      await writeAudit(fetchFn, cfg, {
        user_id: userId, role: profile.role, action: "api_denied", route: policy.route, outcome: code,
      });
    }
    return deny(code);
  };

  if (!profile) return deny("account_not_found");
  if (profile.active !== true) return refuse("account_inactive");
  if (profile.verified !== true) return refuse("account_unverified");
  if (profile.must_change_password === true) return refuse("password_change_required");

  // 3. Role
  if (!policy.roles.includes(profile.role)) return refuse("role_not_allowed");

  // 4. Authenticator-app code for doctors and admins
  if (MFA_ROLES.includes(profile.role) && claims.aal !== "aal2") return refuse("mfa_required");

  // 5. Request limit, counted in one atomic step in the database
  const limit = Number(policy.limitPerHour) || Number(env.RATE_LIMIT_PER_HOUR) || DEFAULT_LIMIT_PER_HOUR;
  try {
    const res = await call(fetchFn, `${url}/rest/v1/rpc/consume_usage`, {
      method: "POST",
      headers: { apikey: secret, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_user_id: userId, p_route: policy.route, p_window_seconds: WINDOW_SECONDS, p_limit: limit }),
    });
    if (!res.ok) return deny("auth_unavailable");
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || typeof row.allowed !== "boolean") return deny("auth_unavailable");
    if (!row.allowed) {
      const resetAt = Date.parse(row.period_start) + WINDOW_SECONDS * 1000;
      const retryAfter = Number.isFinite(resetAt) ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)) : WINDOW_SECONDS;
      await writeAudit(fetchFn, cfg, {
        user_id: userId, role: profile.role, action: "api_denied", route: policy.route, outcome: "rate_limited",
      });
      return deny("rate_limited", { retryAfter });
    }
  } catch {
    return deny("auth_unavailable");
  }

  await writeAudit(fetchFn, cfg, {
    user_id: userId, role: profile.role, action: "api_call", route: policy.route, outcome: "ok",
  });
  return { allowed: true, enforced: true, userId, role: profile.role };
}

/**
 * Route helper: returns true when the request may continue. Otherwise it has already sent the
 * reply and the route must stop:   if (!(await guard(req, res, POLICY))) return;
 */
export async function guard(req, res, policy, deps = {}) {
  const result = await authenticate(req, policy, deps);
  if (result.allowed) {
    req.auth = result.enforced ? { userId: result.userId, role: result.role } : null;
    return true;
  }
  const headers = { "Content-Type": "application/json", ...corsHeaders };
  if (result.retryAfter) headers["Retry-After"] = String(result.retryAfter);
  res.writeHead(result.status, headers);
  res.end(JSON.stringify({ error: result.error, code: result.code }));
  return false;
}
