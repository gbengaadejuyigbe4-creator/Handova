import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { criticalRecall, criticalTokens, summarize, tokenize, wer } from "../tools/voice-metrics.js";
import { evaluateFolder } from "../tools/voice-eval.mjs";

describe("word error rate", () => {
  it("is zero for identical text, ignoring case and punctuation", () => {
    expect(wer("Vital signs stable.", "vital signs stable").rate).toBe(0);
  });
  it("counts a substituted word", () => {
    const r = wer("vital signs stable", "bacter signs stable");
    expect(r).toEqual({ distance: 1, refLength: 3, rate: 1 / 3 });
  });
  it("counts a missing word and an extra word", () => {
    expect(wer("pulse is 88", "pulse 88").distance).toBe(1);
    expect(wer("pulse 88", "the pulse is 88").distance).toBe(2);
  });
  it("handles empty text", () => {
    expect(wer("", "").rate).toBe(0);
    expect(wer("", "extra").rate).toBe(1);
    expect(wer("one two", "").rate).toBe(1);
  });
  it("keeps numbers like 36.8 and 120/80 whole", () => {
    expect(tokenize("Temp 36.8, BP 120/80.")).toEqual(["temp", "36.8", "bp", "120/80"]);
  });
});

describe("critical recall", () => {
  const said = "Gave furosemide 40 mg IV. Vital signs BP 120/80, SpO2 98 percent.";
  it("finds the numbers, units, medicines and key terms that were said", () => {
    const c = criticalTokens(said);
    expect(c.numbers).toEqual(expect.arrayContaining(["40", "120/80", "98"]));
    expect(c.units).toEqual(expect.arrayContaining(["mg", "percent"]));
    expect(c.medicines).toEqual(["furosemide"]);
    expect(c.terms).toEqual(expect.arrayContaining(["vital signs"]));
  });
  it("scores a perfect transcript at 100%", () => {
    const r = criticalRecall(said, said);
    for (const k of ["numbers", "units", "medicines", "terms"]) expect(r[k].found).toBe(r[k].expected);
  });
  it("reports exactly what was lost: a wrong dose is a missed number, not a small error", () => {
    const r = criticalRecall(said, "Gave furosemide 14 mg IV. Bacter signs BP 120/80, SpO2 98 percent.");
    expect(r.numbers.missing).toEqual(["40"]);
    expect(r.terms.missing).toEqual(["vital signs"]);
    expect(r.medicines.missing).toEqual([]);
  });
  it("does not let one correct number cover two that were said", () => {
    expect(criticalRecall("BP 80 and pulse 80", "BP 80 and pulse").numbers.missing).toEqual(["80"]);
  });
  it("summarises many recordings", () => {
    const rows = [
      { wer: wer("pulse 88", "pulse 88"), rawWer: wer("pulse 88", "pulse 88"), critical: criticalRecall("pulse 88", "pulse 88") },
      { wer: wer("pulse 88", "pulse 18"), rawWer: wer("pulse 88", "pulse 18"), critical: criticalRecall("pulse 88", "pulse 18") },
    ];
    const s = summarize(rows);
    expect(s.files).toBe(2);
    expect(s.wordErrorRate).toBe(25);
    expect(s.criticalRecall.numbers).toEqual({ found: 1, expected: 2, percent: 50 });
  });
});

describe("evaluating a folder of recordings", () => {
  it("sends each recording, cleans the result, and scores it against what was said", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "voice-eval-"));
    await writeFile(path.join(dir, "a.webm"), Buffer.alloc(1200, 1));
    await writeFile(path.join(dir, "a.txt"), "Vital signs stable. Pulse 88.");
    await writeFile(path.join(dir, "b.wav"), Buffer.alloc(1200, 2));          // no reference: skipped
    await writeFile(path.join(dir, "notes.md"), "not audio");

    const asked = [];
    const fetchFn = async (url, init) => {
      asked.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ results: { channels: [{ alternatives: [{ transcript: "Bacter signs stable. Pulse 88.", words: [] }] }] } }) };
    };
    const out = await evaluateFolder(dir, { language: "en-GB", apiKey: "k", fetchFn });
    expect(asked).toHaveLength(1);
    expect(asked[0].url).toContain("language=en-GB&");
    expect(asked[0].init.headers.Authorization).toBe("Token k");
    expect(asked[0].init.headers["Content-Type"]).toBe("audio/webm");
    expect(out.results).toHaveLength(1);
    expect(out.results[0].heard).toBe("Bacter signs stable. Pulse 88.");
    expect(out.results[0].cleaned).toBe("Vital signs stable. Pulse 88.");
    expect(out.results[0].rawWer.distance).toBe(1);
    expect(out.results[0].wer.distance).toBe(0);
    expect(out.summary.wordErrorRate).toBe(0);
    expect(out.summary.wordErrorRateBeforeCleaning).toBeGreaterThan(0);
  });
  it("can run without key terms, to measure what they add", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "voice-eval-"));
    await writeFile(path.join(dir, "a.mp3"), Buffer.alloc(1200, 1));
    await writeFile(path.join(dir, "a.txt"), "ok");
    let url;
    await evaluateFolder(dir, { keyterms: [], apiKey: "k", fetchFn: async (u) => { url = u; return { ok: true, status: 200, json: async () => ({}) }; } });
    expect(url).not.toContain("keyterm=");
  });
  it("stops with a clear message when Deepgram refuses", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "voice-eval-"));
    await writeFile(path.join(dir, "a.webm"), Buffer.alloc(1200, 1));
    await writeFile(path.join(dir, "a.txt"), "ok");
    await expect(evaluateFolder(dir, { apiKey: "bad", fetchFn: async () => ({ ok: false, status: 401, json: async () => ({}) }) })).rejects.toThrow("a.webm: Deepgram answered 401");
  });
});
