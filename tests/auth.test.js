import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  authenticate, guard, isEnforced, readClaims, patientRoute, adminRoute,
  PATIENT_ROLES, MFA_ROLES, DEFAULT_LIMIT_PER_HOUR, WINDOW_SECONDS,
} from "../api/_auth.js";
import { makeReq, makeRes } from "./helpers.js";

// Everything here is invented: fake project, fake keys, fake people. No real service is called.
const URL_ = "https://fake-project.supabase.test";
const SECRET = "sb_secret_FAKE_for_tests_only";
const PUBLISHABLE = "sb_publishable_FAKE_for_tests_only";
const USER = "11111111-2222-3333-4444-555555555555";
const ENV = { AUTH_ENFORCED: "true", SUPABASE_URL: URL_, SUPABASE_SECRET_KEY: SECRET, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims = {}) => `${b64({ alg: "ES256" })}.${b64({ sub: USER, aal: "aal1", ...claims })}.sig`;

const profile = (over = {}) => ({ role: "nurse", active: true, verified: true, must_change_password: false, ...over });
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** A fake Supabase. `o` changes how it behaves; `calls` records every request. */
function fakeSupabase(o = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    if (o.throwOn && call.url.includes(o.throwOn)) throw Object.assign(new Error("network"), { name: "AbortError" });
    if (call.url.includes("/auth/v1/user")) return o.userReply || reply(200, { id: USER, email: "x@test.invalid" });
    if (call.url.includes("/rest/v1/profiles")) {
      if (o.profileReply) return o.profileReply;
      return reply(200, o.profile === null ? [] : [profile(o.profile)]);
    }
    if (call.url.includes("/rest/v1/rpc/consume_usage")) {
      return o.rpcReply || reply(200, [{ allowed: o.allowed !== false, used: o.used || 1, period_start: o.periodStart || new Date().toISOString() }]);
    }
    if (call.url.includes("/rest/v1/audit_log")) return o.auditReply || reply(201, null);
    throw new Error(`unexpected call ${call.url}`);
  };
  return { fetch, calls, audits: () => calls.filter((c) => c.url.includes("/audit_log")), rpcs: () => calls.filter((c) => c.url.includes("consume_usage")) };
}

const reqWith = (token = jwt()) => ({ headers: token === null ? {} : { authorization: `Bearer ${token}` } });
const POLICY = patientRoute("/api/specialist");
const run = (sb, { policy = POLICY, req = reqWith(), env = ENV } = {}) => authenticate(req, policy, { fetch: sb.fetch, env });

// ---------------------------------------------------------------------------------------
describe("switched off", () => {
  it.each([undefined, "", "false", "no", "0", "TRUEISH"])("does nothing when AUTH_ENFORCED is %j", async (value) => {
    const sb = fakeSupabase();
    const out = await run(sb, { req: reqWith(null), env: { ...ENV, AUTH_ENFORCED: value } });
    expect(out).toEqual({ allowed: true, enforced: false });
    expect(sb.calls).toHaveLength(0);
  });
  it("turns on for true in any case", () => {
    expect(isEnforced({ AUTH_ENFORCED: "true" })).toBe(true);
    expect(isEnforced({ AUTH_ENFORCED: " TRUE " })).toBe(true);
  });
});

describe("the token", () => {
  it("refuses a request with no token, without calling Supabase", async () => {
    const sb = fakeSupabase();
    const out = await run(sb, { req: reqWith(null) });
    expect(out).toMatchObject({ allowed: false, status: 401, code: "sign_in_required" });
    expect(sb.calls).toHaveLength(0);
  });
  it.each(["Token abc", "Bearer", "Bearer ", "abc", "Basic abc"])("refuses the malformed header %j", async (header) => {
    const sb = fakeSupabase();
    const out = await run(sb, { req: { headers: { authorization: header } } });
    expect(out.code).toBe("sign_in_required");
    expect(sb.calls).toHaveLength(0);
  });
  it("refuses a token Supabase rejects", async () => {
    const out = await run(fakeSupabase({ userReply: reply(401, { msg: "bad jwt" }) }));
    expect(out).toMatchObject({ allowed: false, status: 401, code: "invalid_token" });
  });
  it("refuses an answer with no usable user id", async () => {
    expect((await run(fakeSupabase({ userReply: reply(200, {}) }))).code).toBe("invalid_token");
    expect((await run(fakeSupabase({ userReply: reply(200, { id: "../../etc" }) }))).code).toBe("invalid_token");
  });
  it("fails closed when Supabase cannot be reached or errors", async () => {
    expect((await run(fakeSupabase({ userReply: reply(500, {}) }))).code).toBe("auth_unavailable");
    expect((await run(fakeSupabase({ throwOn: "/auth/v1/user" }))).code).toBe("auth_unavailable");
    expect((await run(fakeSupabase({ profileReply: reply(500, {}) }))).code).toBe("auth_unavailable");
    expect((await run(fakeSupabase({ throwOn: "/rest/v1/profiles" }))).code).toBe("auth_unavailable");
    expect((await run(fakeSupabase({ rpcReply: reply(500, {}) }))).code).toBe("auth_unavailable");
    expect((await run(fakeSupabase({ throwOn: "consume_usage" }))).code).toBe("auth_unavailable");
  });
  it("is a 503, never a pass, when the limit check returns nonsense", async () => {
    expect((await run(fakeSupabase({ rpcReply: reply(200, [{ nope: 1 }]) }))).allowed).toBe(false);
    expect((await run(fakeSupabase({ rpcReply: reply(200, []) }))).allowed).toBe(false);
  });
  it("refuses everything when the server is missing its keys", async () => {
    for (const drop of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
      const sb = fakeSupabase();
      const out = await run(sb, { env: { ...ENV, [drop]: "" } });
      expect(out).toMatchObject({ allowed: false, status: 500, code: "server_misconfigured" });
      expect(sb.calls).toHaveLength(0);
    }
  });
  it("reads the claims of a token, and returns nothing for junk", () => {
    expect(readClaims(jwt({ aal: "aal2" })).aal).toBe("aal2");
    expect(readClaims("junk")).toEqual({});
    expect(readClaims("a.b.c")).toEqual({});
    expect(readClaims(undefined)).toEqual({});
  });
});

describe("the account", () => {
  it("refuses a person who has no profile", async () => {
    const sb = fakeSupabase({ profile: null });
    expect(await run(sb)).toMatchObject({ status: 403, code: "account_not_found" });
    expect(sb.audits()).toHaveLength(0); // we do not know their role, so there is nothing to record
  });
  it.each([
    [{ active: false }, "account_inactive"],
    [{ verified: false }, "account_unverified"],
    [{ must_change_password: true }, "password_change_required"],
    [{ active: null }, "account_inactive"],
    [{ verified: "yes" }, "account_unverified"],
  ])("refuses %j", async (over, code) => {
    const out = await run(fakeSupabase({ profile: over }));
    expect(out).toMatchObject({ allowed: false, status: 403, code });
  });
  it("checks the account before the role, and before counting the request", async () => {
    const sb = fakeSupabase({ profile: { active: false, role: "admin" } });
    expect((await run(sb)).code).toBe("account_inactive");
    expect(sb.rpcs()).toHaveLength(0);
  });
  it("asks for the profile with the server key and never sends the person's token to the database", async () => {
    const sb = fakeSupabase();
    const token = jwt();
    await run(sb, { req: reqWith(token) });
    const profileCall = sb.calls.find((c) => c.url.includes("/rest/v1/profiles"));
    expect(profileCall.headers.apikey).toBe(SECRET);
    expect(JSON.stringify(profileCall.headers)).not.toContain(token);
    expect(profileCall.url).toContain(`id=eq.${USER}`);
  });
  it("checks the token with the publishable key and never sends the secret key there", async () => {
    const sb = fakeSupabase();
    await run(sb);
    const userCall = sb.calls.find((c) => c.url.includes("/auth/v1/user"));
    expect(userCall.headers.apikey).toBe(PUBLISHABLE);
    expect(JSON.stringify(userCall.headers)).not.toContain(SECRET);
  });
});

describe("roles", () => {
  const patientRoles = ["nurse", "nurse_in_charge", "doctor"];
  it.each(patientRoles)("lets a %s use a patient route", async (role) => {
    const out = await run(fakeSupabase({ profile: { role } }), { req: reqWith(jwt({ aal: "aal2" })) });
    expect(out).toMatchObject({ allowed: true, enforced: true, role, userId: USER });
  });
  it("keeps an admin out of patient routes", async () => {
    const sb = fakeSupabase({ profile: { role: "admin" } });
    expect(await run(sb, { req: reqWith(jwt({ aal: "aal2" })) })).toMatchObject({ allowed: false, status: 403, code: "role_not_allowed" });
    expect(sb.rpcs()).toHaveLength(0);
  });
  it("lets an admin, and only an admin, use an admin route", async () => {
    const policy = adminRoute("/api/admin");
    expect((await run(fakeSupabase({ profile: { role: "admin" } }), { policy, req: reqWith(jwt({ aal: "aal2" })) })).allowed).toBe(true);
    for (const role of patientRoles) {
      expect((await run(fakeSupabase({ profile: { role } }), { policy, req: reqWith(jwt({ aal: "aal2" })) })).code).toBe("role_not_allowed");
    }
  });
  it("refuses a role the database does not know", async () => {
    expect((await run(fakeSupabase({ profile: { role: "superuser" } }))).code).toBe("role_not_allowed");
    expect((await run(fakeSupabase({ profile: { role: null } }))).code).toBe("role_not_allowed");
  });
  it("is the database that decides: nothing in the request can change the role", async () => {
    const req = { headers: { authorization: `Bearer ${jwt({ role: "doctor", app_role: "admin" })}`, "x-role": "doctor" }, body: { role: "doctor" } };
    const out = await run(fakeSupabase({ profile: { role: "nurse" } }), { req });
    expect(out.role).toBe("nurse");
  });
});

describe("authenticator-app confirmation", () => {
  it("is required for doctors and admins", () => {
    expect(MFA_ROLES).toEqual(["doctor", "admin"]);
  });
  it("refuses a doctor signed in with a password only", async () => {
    const sb = fakeSupabase({ profile: { role: "doctor" } });
    expect(await run(sb, { req: reqWith(jwt({ aal: "aal1" })) })).toMatchObject({ status: 403, code: "mfa_required" });
    expect(sb.rpcs()).toHaveLength(0);
  });
  it("refuses a doctor whose token says nothing about it", async () => {
    const token = `${b64({})}.${b64({ sub: USER })}.sig`;
    expect((await run(fakeSupabase({ profile: { role: "doctor" } }), { req: reqWith(token) })).code).toBe("mfa_required");
  });
  it("lets a doctor in once they have confirmed", async () => {
    expect((await run(fakeSupabase({ profile: { role: "doctor" } }), { req: reqWith(jwt({ aal: "aal2" })) })).allowed).toBe(true);
  });
  it("refuses an admin without it", async () => {
    const policy = adminRoute("/api/admin");
    expect((await run(fakeSupabase({ profile: { role: "admin" } }), { policy, req: reqWith(jwt({ aal: "aal1" })) })).code).toBe("mfa_required");
  });
  it("does not ask nurses for it", async () => {
    for (const role of ["nurse", "nurse_in_charge"]) {
      expect((await run(fakeSupabase({ profile: { role } }), { req: reqWith(jwt({ aal: "aal1" })) })).allowed).toBe(true);
    }
  });
});

describe("request limits", () => {
  it("counts the request against this person, this route and the hour", async () => {
    const sb = fakeSupabase();
    await run(sb);
    expect(sb.rpcs()[0].body).toEqual({ p_user_id: USER, p_route: "/api/specialist", p_window_seconds: WINDOW_SECONDS, p_limit: DEFAULT_LIMIT_PER_HOUR });
    expect(sb.rpcs()[0].headers.apikey).toBe(SECRET);
  });
  it("takes the limit from the route, then the environment, then the default", async () => {
    let sb = fakeSupabase();
    await run(sb, { policy: { ...POLICY, limitPerHour: 7 }, env: { ...ENV, RATE_LIMIT_PER_HOUR: "50" } });
    expect(sb.rpcs()[0].body.p_limit).toBe(7);
    sb = fakeSupabase();
    await run(sb, { env: { ...ENV, RATE_LIMIT_PER_HOUR: "50" } });
    expect(sb.rpcs()[0].body.p_limit).toBe(50);
    sb = fakeSupabase();
    await run(sb, { env: { ...ENV, RATE_LIMIT_PER_HOUR: "garbage" } });
    expect(sb.rpcs()[0].body.p_limit).toBe(DEFAULT_LIMIT_PER_HOUR);
  });
  it("refuses a request over the limit and says when to try again", async () => {
    const start = new Date(Date.now() - 600 * 1000).toISOString(); // the hour began 10 minutes ago
    const out = await run(fakeSupabase({ allowed: false, used: 121, periodStart: start }));
    expect(out).toMatchObject({ allowed: false, status: 429, code: "rate_limited" });
    expect(out.retryAfter).toBeGreaterThan(2900);
    expect(out.retryAfter).toBeLessThanOrEqual(3000);
  });
  it("still gives a retry time when the database does not say when the hour began", async () => {
    const out = await run(fakeSupabase({ allowed: false, periodStart: "nonsense" }));
    expect(out.retryAfter).toBe(WINDOW_SECONDS);
  });
});

describe("the audit log", () => {
  it("records an allowed call, and only who, what, when and the outcome", async () => {
    const sb = fakeSupabase({ profile: { role: "nurse_in_charge" } });
    await run(sb);
    expect(sb.audits()).toHaveLength(1);
    expect(sb.audits()[0].body).toEqual({ user_id: USER, role: "nurse_in_charge", action: "api_call", route: "/api/specialist", outcome: "ok" });
    expect(sb.audits()[0].headers.apikey).toBe(SECRET);
  });
  it("never records anything from the request body", async () => {
    const sb = fakeSupabase();
    const req = { ...reqWith(), body: { extracted: { name: "Invented Person" }, text: "clinical text" } };
    await run(sb, { req });
    expect(JSON.stringify(sb.audits())).not.toMatch(/Invented|clinical/);
  });
  it.each([
    [{ active: false }, "account_inactive"],
    [{ verified: false }, "account_unverified"],
    [{ must_change_password: true }, "password_change_required"],
    [{ role: "admin" }, "role_not_allowed"],
  ])("records a known person being turned away: %j", async (over, code) => {
    const sb = fakeSupabase({ profile: over });
    await run(sb, { req: reqWith(jwt({ aal: "aal2" })) });
    expect(sb.audits()).toHaveLength(1);
    expect(sb.audits()[0].body).toMatchObject({ user_id: USER, action: "api_denied", outcome: code });
  });
  it("records a missing authenticator confirmation and a rate limit", async () => {
    let sb = fakeSupabase({ profile: { role: "doctor" } });
    await run(sb, { req: reqWith(jwt({ aal: "aal1" })) });
    expect(sb.audits()[0].body).toMatchObject({ action: "api_denied", outcome: "mfa_required", role: "doctor" });
    sb = fakeSupabase({ allowed: false });
    await run(sb);
    expect(sb.audits()[0].body).toMatchObject({ action: "api_denied", outcome: "rate_limited" });
  });
  it("records nothing for strangers, so they cannot fill the log", async () => {
    let sb = fakeSupabase();
    await run(sb, { req: reqWith(null) });
    expect(sb.audits()).toHaveLength(0);
    sb = fakeSupabase({ userReply: reply(401, {}) });
    await run(sb);
    expect(sb.audits()).toHaveLength(0);
    sb = fakeSupabase({ profile: null });
    await run(sb);
    expect(sb.audits()).toHaveLength(0);
  });
  it("does not block a clinician when the audit write fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run(fakeSupabase({ throwOn: "/audit_log" }))).allowed).toBe(true);
    expect((await run(fakeSupabase({ auditReply: reply(500, {}) }))).allowed).toBe(true);
    spy.mockRestore();
  });
});

describe("guard() as the routes use it", () => {
  const callGuard = async (sb, { policy = POLICY, req = reqWith(), env = ENV } = {}) => {
    const res = makeRes();
    const request = { ...req };
    const proceed = await guard(request, res, policy, { fetch: sb.fetch, env });
    return { proceed, res, request };
  };
  it("lets the route continue when switched off, and says nothing", async () => {
    const { proceed, res, request } = await callGuard(fakeSupabase(), { env: {} });
    expect(proceed).toBe(true);
    expect(res.statusCode).toBeNull();
    expect(request.auth).toBeNull();
  });
  it("lets the route continue and tells it who is calling", async () => {
    const { proceed, res, request } = await callGuard(fakeSupabase({ profile: { role: "nurse" } }));
    expect(proceed).toBe(true);
    expect(res.statusCode).toBeNull();
    expect(request.auth).toEqual({ userId: USER, role: "nurse" });
  });
  it("sends the refusal itself, as JSON, with the cross-origin headers", async () => {
    const { proceed, res } = await callGuard(fakeSupabase(), { req: reqWith(null) });
    expect(proceed).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(res.headers["Access-Control-Allow-Headers"]).toMatch(/Authorization/);
    expect(res.json).toEqual({ error: "Please sign in to continue.", code: "sign_in_required" });
  });
  it("adds Retry-After to a rate limit refusal", async () => {
    const { res } = await callGuard(fakeSupabase({ allowed: false }));
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["Retry-After"])).toBeGreaterThan(0);
  });
  it("never puts a key, a token or the person's id in a refusal", async () => {
    const token = jwt();
    for (const sb of [fakeSupabase({ profile: { active: false } }), fakeSupabase({ userReply: reply(401, {}) }), fakeSupabase({ allowed: false })]) {
      const { res } = await callGuard(sb, { req: reqWith(token) });
      expect(res.body).not.toContain(SECRET);
      expect(res.body).not.toContain(PUBLISHABLE);
      expect(res.body).not.toContain(token);
      expect(res.body).not.toContain(USER);
    }
  });
});

// ---------------------------------------------------------------------------------------
// Every route must be behind the guard, and the guard must come first.
// ---------------------------------------------------------------------------------------
const ROUTES = ["extract-emr", "generate", "generate-questions", "handover-brief", "plan-shift", "predict-flags", "shift-update", "specialist", "transcribe"];

describe("every route is behind the guard", () => {
  it.each(ROUTES)("%s: guarded, for patient roles, after the method check and before any work", (name) => {
    const src = readFileSync(`api/${name}.js`, "utf8");
    expect(src).toContain('import { guard, patientRoute } from "./_auth.js"');
    expect(src).toContain(`patientRoute("/api/${name}")`);
    const at = src.indexOf("await guard(req, res, AUTH_POLICY)");
    expect(at).toBeGreaterThan(-1);
    expect(src.indexOf("await guard(", at + 1)).toBe(-1); // exactly once
    const handler = src.indexOf("export default async function handler");
    const methodCheck = src.indexOf('req.method !== "POST"');
    expect(handler).toBeLessThan(methodCheck);
    expect(methodCheck).toBeLessThan(at);
    // nothing happens before the guard: no rate limit, no key check, no body read, no AI call
    const beforeGuard = src.slice(handler, at);
    for (const word of ["getRealIP(", "isRateLimited(", "gemini(", "fetch(", "JSON.parse", "req.body", "GEMINI_API_KEY", "ENABLE_SPECIALIST"]) {
      expect(beforeGuard).not.toContain(word);
    }
  });
  it("answers the browser's pre-flight check without needing a token", () => {
    for (const name of ROUTES) {
      const src = readFileSync(`api/${name}.js`, "utf8");
      const options = src.indexOf('req.method === "OPTIONS"');
      expect(options).toBeGreaterThan(-1);
      expect(options).toBeLessThan(src.indexOf("await guard("));
    }
  });
  it("lets the browser send the Authorization header", () => {
    expect(readFileSync("api/_groq.js", "utf8")).toMatch(/Allow-Headers": "Content-Type, Authorization"/);
    expect(readFileSync("api/transcribe.js", "utf8")).toMatch(/Allow-Headers": "Content-Type, Authorization"/);
  });
});

describe("the routes, with the guard switched on", () => {
  const saved = {};
  const keys = ["AUTH_ENFORCED", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_PUBLISHABLE_KEY"];
  let sb;
  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
    Object.assign(process.env, ENV);
    sb = fakeSupabase({ profile: { role: "nurse" } });
    // Any call that is not to Supabase would be an AI call: record it.
    globalThis.__aiCalls = [];
    vi.stubGlobal("fetch", async (url, init) => {
      if (String(url).startsWith(URL_)) return sb.fetch(url, init);
      globalThis.__aiCalls.push(String(url));
      return reply(200, {});
    });
  });
  afterEach(() => {
    for (const k of keys) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
    vi.unstubAllGlobals();
    delete globalThis.__aiCalls;
  });

  it.each(ROUTES)("%s: refuses a request with no token and makes no AI call", async (name) => {
    const { default: handler } = await import(`../api/${name}.js`);
    const res = makeRes();
    await handler(makeReq({ anything: true }), res);
    expect(res.statusCode).toBe(401);
    expect(res.json.code).toBe("sign_in_required");
    expect(globalThis.__aiCalls).toEqual([]);
    expect(sb.calls).toHaveLength(0);
  });

  it.each(ROUTES.filter((n) => n !== "transcribe"))("%s: lets a signed-in nurse through to the route's own checks", async (name) => {
    const { default: handler } = await import(`../api/${name}.js`);
    const res = makeRes();
    await handler(makeReq({}, { headers: { authorization: `Bearer ${jwt()}` } }), res);
    expect([401, 403, 429]).not.toContain(res.statusCode); // past the guard; the route then judges its own input
    expect(sb.audits()).toHaveLength(1);
    expect(sb.audits()[0].body.route).toBe(`/api/${name}`);
  });

  it.each(ROUTES)("%s: turns away an admin and makes no AI call", async (name) => {
    sb = fakeSupabase({ profile: { role: "admin" } });
    const { default: handler } = await import(`../api/${name}.js`);
    const res = makeRes();
    await handler(makeReq({}, { headers: { authorization: `Bearer ${jwt({ aal: "aal2" })}` } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.json.code).toBe("role_not_allowed");
    expect(globalThis.__aiCalls).toEqual([]);
  });

  it.each(ROUTES)("%s: still answers a pre-flight check with no token", async (name) => {
    const { default: handler } = await import(`../api/${name}.js`);
    const res = makeRes();
    await handler(makeReq(undefined, { method: "OPTIONS" }), res);
    expect(res.statusCode).toBe(204);
    expect(sb.calls).toHaveLength(0);
  });
});
