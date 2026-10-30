import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, mockGroq, ok } from "./helpers.js";

// _groq.js keeps module-level state (model cooldowns, rate-limit counters), so each
// test loads a fresh copy of it.
async function loadGroq() {
  vi.resetModules();
  return import("../api/_groq.js");
}

beforeEach(() => {
  delete process.env.GROQ_MODELS;
  process.env.GROQ_API_KEY = "test-groq-key";
});

describe("extractJson", () => {
  it("parses plain JSON", async () => {
    const { extractJson } = await loadGroq();
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences", async () => {
    const { extractJson } = await loadGroq();
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("removes thinking blocks", async () => {
    const { extractJson } = await loadGroq();
    expect(extractJson('<thinking>let me think {"x":9}</thinking>{"a":1}')).toEqual({ a: 1 });
  });

  it("finds JSON inside surrounding text", async () => {
    const { extractJson } = await loadGroq();
    expect(extractJson('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
  });

  it("throws a readable error when nothing parses", async () => {
    const { extractJson } = await loadGroq();
    expect(() => extractJson("no json here")).toThrow(/Could not parse AI response/);
  });
});

describe("getRealIP and isRateLimited", () => {
  it("uses the first x-forwarded-for address", async () => {
    const { getRealIP } = await loadGroq();
    expect(getRealIP({ headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } })).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip, then unknown", async () => {
    const { getRealIP } = await loadGroq();
    expect(getRealIP({ headers: { "x-real-ip": "3.3.3.3" } })).toBe("3.3.3.3");
    expect(getRealIP({ headers: {} })).toBe("unknown");
  });

  it("blocks after the limit and resets after the window", async () => {
    vi.useFakeTimers();
    const { isRateLimited } = await loadGroq();
    expect(isRateLimited("a", 2, 1000)).toBe(false);
    expect(isRateLimited("a", 2, 1000)).toBe(false);
    expect(isRateLimited("a", 2, 1000)).toBe(true);
    expect(isRateLimited("b", 2, 1000)).toBe(false); // other IPs are independent
    vi.advanceTimersByTime(1500);
    expect(isRateLimited("a", 2, 1000)).toBe(false);
  });
});

describe("gemini() model rotation", () => {
  it("fails clearly when the API key is missing", async () => {
    delete process.env.GROQ_API_KEY;
    const { gemini } = await loadGroq();
    await expect(gemini("hi")).rejects.toThrow(/GROQ_API_KEY/);
  });

  it("returns the reply from the first model", async () => {
    const { calls } = mockGroq({}, ok("hello"));
    const { gemini } = await loadGroq();
    await expect(gemini("hi", { maxOutputTokens: 2000 })).resolves.toBe("hello");
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("openai/gpt-oss-120b");
  });

  it("prefers the fast model for small outputs", async () => {
    const { calls } = mockGroq({}, ok("hello"));
    const { gemini } = await loadGroq();
    await gemini("hi", { maxOutputTokens: 1000 });
    expect(calls[0].model).toBe("openai/gpt-oss-20b");
  });

  it("skips a retired model and succeeds with the next one (the October 2026 failure)", async () => {
    const { calls } = mockGroq({
      "openai/gpt-oss-120b": fail(404, "model_not_found", "The model does not exist or you do not have access to it."),
    }, ok("from fallback"));
    const { gemini } = await loadGroq();
    await expect(gemini("hi", { maxOutputTokens: 2000 })).resolves.toBe("from fallback");
    expect(calls.map((c) => c.model)).toEqual(["openai/gpt-oss-120b", "qwen/qwen3.6-27b"]);
  });

  it("remembers a retired model and does not try it again", async () => {
    const { calls } = mockGroq({
      "openai/gpt-oss-120b": fail(404, "model_not_found", "does not exist"),
    }, ok("fine"));
    const { gemini } = await loadGroq();
    await gemini("one", { maxOutputTokens: 2000 });
    calls.length = 0;
    await gemini("two", { maxOutputTokens: 2000 });
    expect(calls.map((c) => c.model)).not.toContain("openai/gpt-oss-120b");
  });

  it("rotates to another model on a rate limit (429)", async () => {
    const { calls } = mockGroq({ "openai/gpt-oss-120b": { status: 429, body: {} } }, ok("ok"));
    const { gemini } = await loadGroq();
    await expect(gemini("hi", { maxOutputTokens: 2000 })).resolves.toBe("ok");
    expect(calls[0].model).toBe("openai/gpt-oss-120b");
    expect(calls[1].model).not.toBe("openai/gpt-oss-120b");
  });

  it("does not rotate on other errors such as a bad key; it reports them", async () => {
    const { calls } = mockGroq({}, fail(401, "invalid_api_key", "Invalid API Key"));
    const { gemini } = await loadGroq();
    await expect(gemini("hi")).rejects.toThrow("Invalid API Key");
    expect(calls).toHaveLength(1);
  });

  it("retries after an empty reply and reports a clear error if every attempt is empty", async () => {
    const { calls } = mockGroq({}, ok(""));
    const { gemini } = await loadGroq();
    await expect(gemini("hi", { maxOutputTokens: 2000 })).rejects.toThrow(/Empty response/);
    expect(calls.length).toBeGreaterThan(1);
  });

  // Found by writing these tests: after an empty reply the helper retries the SAME model
  // instead of moving to the next one. Reasoning models can return empty text when they
  // use up their token budget thinking, so rotating would be safer. Not changed in Phase 0.
  it.todo("moves to the next model after an empty reply");

  it("ends with a clear error when every model is retired", async () => {
    vi.useFakeTimers();
    mockGroq({}, fail(404, "model_not_found", "The model does not exist"));
    const { gemini } = await loadGroq();
    const result = gemini("hi", { maxOutputTokens: 2000 }).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await result;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/does not exist/);
  });

  it("uses GROQ_MODELS from the environment when set", async () => {
    process.env.GROQ_MODELS = "custom/model-a,custom/model-b";
    const { calls } = mockGroq({}, ok("ok"));
    const { gemini } = await loadGroq();
    await gemini("hi", { maxOutputTokens: 2000 });
    expect(calls[0].model).toBe("custom/model-a");
  });

  it("asks reasoning models for low effort and gives them extra token headroom", async () => {
    const { calls } = mockGroq({}, ok("ok"));
    const { gemini } = await loadGroq();
    await gemini("hi", { maxOutputTokens: 2000 });
    expect(calls[0].reasoning_effort).toBe("low");
    expect(calls[0].max_tokens).toBeGreaterThan(2000);
  });
});
