import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

// ---- Fake request / response objects for the serverless handlers -------------
let ipCounter = 0;

export function makeReq(body, { method = "POST", headers = {} } = {}) {
  ipCounter += 1;
  // A different IP per request so the in-memory rate limiter never interferes.
  return { method, headers: { "x-forwarded-for": `10.0.0.${ipCounter}`, ...headers }, body, socket: {} };
}

export function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(body) { this.body = body || ""; },
    get json() { try { return JSON.parse(this.body); } catch { return null; } },
  };
}

// ---- Fake Groq server ---------------------------------------------------------
// `plan` maps a model id to a response. `fallback` is used for any other model.
//   ok("text")                       -> a normal reply
//   fail(404, "model_not_found")     -> an error reply
export const ok = (text) => ({ status: 200, body: { choices: [{ message: { content: text } }] } });
export const fail = (status, code = "", message = "error") => ({ status, body: { error: { code, message } } });

export function mockGroq(plan = {}, fallback = ok("{}")) {
  const calls = [];
  const fetchMock = vi.fn(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const r = plan[body.model] || fallback;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: () => null },
      json: async () => r.body,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

// ---- Synthetic PDF fixtures ------------------------------------------------------
// Small invented PDFs made by tests/fixtures/make_fixtures.py. No real patient data.
export function fixtureBase64(name) {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return readFileSync(path).toString("base64");
}
