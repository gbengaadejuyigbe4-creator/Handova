import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/transcribe.js";
import { KEYTERMS } from "../api/_speech.js";
import { makeRes } from "./helpers.js";

// A fake Deepgram. No real audio and no real service: the point is what Handova sends and what it returns.

let ip = 0;
/** A request the way the serverless runtime hands it over: headers plus a stream of body chunks. */
function multipartReq(audio, { mime = "audio/webm", field = "audio", contentType, headers = {} } = {}) {
  ip += 1;
  const boundary = "----HandovaTestBoundary";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="recording.webm"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, audio, tail]);
  const chunks = [];
  for (let i = 0; i < body.length; i += 4096) chunks.push(body.subarray(i, i + 4096));
  return {
    method: "POST",
    headers: { "x-forwarded-for": `10.9.0.${ip}`, "content-type": contentType || `multipart/form-data; boundary=${boundary}`, ...headers },
    socket: {},
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; },
  };
}
const audio = (n = 3000) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7) % 251));

const deepgramReply = (transcript, words = []) => ({
  results: { channels: [{ alternatives: [{ transcript, words }] }] },
});
const word = (w, confidence = 0.97) => ({ word: w.toLowerCase().replace(/[^a-z0-9%./]/g, ""), punctuated_word: w, confidence });

let calls;
function fakeDeepgram(reply, { status = 200 } = {}) {
  calls = [];
  vi.stubGlobal("fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => reply };
  });
}

const saved = {};
beforeEach(() => {
  saved.key = process.env.DEEPGRAM_API_KEY; saved.lang = process.env.DEEPGRAM_LANGUAGE; saved.auth = process.env.AUTH_ENFORCED;
  process.env.DEEPGRAM_API_KEY = "dg-fake-key-for-tests";
  delete process.env.DEEPGRAM_LANGUAGE;
  delete process.env.AUTH_ENFORCED;
});
afterEach(() => {
  for (const [k, v] of [["DEEPGRAM_API_KEY", saved.key], ["DEEPGRAM_LANGUAGE", saved.lang], ["AUTH_ENFORCED", saved.auth]]) {
    v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
  vi.unstubAllGlobals();
});
const post = async (req) => { const res = makeRes(); await handler(req, res); return res; };

describe("what Handova sends to Deepgram", () => {
  it("asks for the medical model, with the clinical key terms", async () => {
    fakeDeepgram(deepgramReply("ok"));
    await post(multipartReq(audio()));
    expect(calls).toHaveLength(1);
    const url = calls[0].url;
    expect(url).toContain("https://api.deepgram.com/v1/listen?");
    expect(url).toContain("model=nova-3-medical");
    expect(url).toContain("keyterm=vital%20signs");
    expect(url.match(/keyterm=/g)).toHaveLength(KEYTERMS.length);
  });
  it("uses the plain English code unless the server sets another allowed one", async () => {
    fakeDeepgram(deepgramReply("ok"));
    await post(multipartReq(audio()));
    expect(calls[0].url).toContain("language=en&");
    process.env.DEEPGRAM_LANGUAGE = "en-GB";
    await post(multipartReq(audio()));
    expect(calls[1].url).toContain("language=en-GB&");
    process.env.DEEPGRAM_LANGUAGE = "en-NG";
    await post(multipartReq(audio()));
    expect(calls[2].url).toContain("language=en&");
  });
  it("sends the recording unchanged, with the key and the recording's own type", async () => {
    fakeDeepgram(deepgramReply("ok"));
    const clip = audio(5000);
    await post(multipartReq(clip, { mime: "audio/mp4" }));
    const init = calls[0].init;
    expect(init.headers.Authorization).toBe("Token dg-fake-key-for-tests");
    expect(init.headers["Content-Type"]).toBe("audio/mp4");
    expect(Buffer.compare(Buffer.from(init.body), clip)).toBe(0);
  });
  it("accepts the recording under the name file as well", async () => {
    fakeDeepgram(deepgramReply("ok"));
    expect((await post(multipartReq(audio(), { field: "file" }))).statusCode).toBe(200);
  });
});

describe("what comes back", () => {
  it("returns the cleaned text, the raw text and the notes", async () => {
    const heard = "Bacter signs: bp 120 over 80, pulse 88.";
    fakeDeepgram(deepgramReply(heard, heard.split(" ").map((w) => word(w))));
    const res = await post(multipartReq(audio()));
    expect(res.statusCode).toBe(200);
    expect(res.json.text).toBe("Vital signs: BP 120 over 80, pulse 88.");
    expect(res.json.rawText).toBe(heard);
    expect(res.json.notes).toEqual([expect.objectContaining({ kind: "changed", from: "Bacter signs", to: "Vital signs" })]);
  });
  it("keeps `text` a plain string, so an older page still works", async () => {
    fakeDeepgram(deepgramReply("Patient slept well."));
    const res = await post(multipartReq(audio()));
    expect(typeof res.json.text).toBe("string");
    expect(res.json.text).toBe("Patient slept well.");
    expect(res.json.notes).toEqual([]);
  });
  it("flags a dose Deepgram was unsure of, and changes nothing about it", async () => {
    const heard = "Gave furosemide 40 mg IV";
    fakeDeepgram(deepgramReply(heard, [word("Gave"), word("furosemide"), word("40", 0.4), word("mg"), word("IV")]));
    const res = await post(multipartReq(audio()));
    expect(res.json.text).toBe(heard);
    expect(res.json.notes).toEqual([expect.objectContaining({ kind: "check", field: "dose", from: "40 mg" })]);
  });
  it("copes with a reply that has no words or no transcript", async () => {
    fakeDeepgram(deepgramReply("Pulse 88"));
    expect((await post(multipartReq(audio()))).json.text).toBe("Pulse 88");
    fakeDeepgram({});
    const res = await post(multipartReq(audio()));
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ text: "", rawText: "", notes: [] });
  });
  it("never puts the key or the request address in a reply", async () => {
    fakeDeepgram(deepgramReply("ok"));
    const res = await post(multipartReq(audio()));
    expect(res.body).not.toContain("dg-fake-key");
    expect(res.body).not.toContain("api.deepgram.com");
  });
});

describe("errors and limits stay as before", () => {
  it("reports a Deepgram error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeDeepgram({ err_msg: "Invalid credentials" }, { status: 401 });
    const res = await post(multipartReq(audio()));
    expect(res.statusCode).toBe(500);
    expect(res.json.error).toContain("Invalid credentials");
    expect(res.body).not.toContain("dg-fake-key");
  });
  it("says when the server has no Deepgram key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.DEEPGRAM_API_KEY;
    fakeDeepgram(deepgramReply("ok"));
    const res = await post(multipartReq(audio()));
    expect(res.statusCode).toBe(500);
    expect(calls).toHaveLength(0);
  });
  it("refuses a request that is not a form upload", async () => {
    fakeDeepgram(deepgramReply("ok"));
    const res = await post(multipartReq(audio(), { contentType: "application/json" }));
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it("refuses a recording that is too short", async () => {
    fakeDeepgram(deepgramReply("ok"));
    const res = await post(multipartReq(Buffer.alloc(100)));
    expect(res.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it("refuses a recording over 5 MB", async () => {
    fakeDeepgram(deepgramReply("ok"));
    const res = await post(multipartReq(Buffer.alloc(5 * 1024 * 1024 + 10, 1)));
    expect(res.statusCode).toBe(413);
    expect(calls).toHaveLength(0);
  });
  it("refuses a method other than POST", async () => {
    const res = makeRes();
    await handler({ method: "GET", headers: {}, socket: {} }, res);
    expect(res.statusCode).toBe(405);
  });
  it("limits how often one address can transcribe", async () => {
    fakeDeepgram(deepgramReply("ok"));
    const sameAddress = () => { const r = multipartReq(audio()); r.headers["x-forwarded-for"] = "10.77.0.1"; return r; };
    const statuses = [];
    for (let i = 0; i < 22; i++) statuses.push((await post(sameAddress())).statusCode);
    expect(statuses.filter((s) => s === 200)).toHaveLength(20);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });
  it("still sits behind the sign-in guard", async () => {
    process.env.AUTH_ENFORCED = "true";
    process.env.SUPABASE_URL = "https://fake.supabase.test";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_fake";
    fakeDeepgram(deepgramReply("ok"));
    const res = await post(multipartReq(audio()));
    expect(res.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY;
  });
});
