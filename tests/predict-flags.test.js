import { describe, expect, it } from "vitest";
import handler from "../api/predict-flags.js";
import { FLAG_NOTICE, findUngroundedNumbers, normalizeFlagsResult } from "../api/_flagSafety.js";
import { fail, makeReq, makeRes, mockGroq, ok } from "./helpers.js";

// All data below is invented.
const RECORD = "Synthetic record: BP 160/90 on labetalol 20 mg. Creatinine 185 umol/L, eGFR 29. Hb 11.2 g/dL.";

describe("findUngroundedNumbers", () => {
  it("finds a figure that is not in the record (a converted or invented value)", () => {
    expect(findUngroundedNumbers("Creatinine 185 umol/L (about 2.09 mg/dL)", RECORD)).toEqual(["2.09"]);
  });

  it("accepts figures that are in the record", () => {
    expect(findUngroundedNumbers("BP 160/90, eGFR 29, Hb 11.2", RECORD)).toEqual([]);
  });

  it("treats 4.2 and 4.20 as the same figure", () => {
    expect(findUngroundedNumbers("value 4.2", "reading 4.20")).toEqual([]);
  });

  it("ignores small whole numbers, years and timings", () => {
    expect(findUngroundedNumbers("Recheck every 15 minutes for 7-14 days, 3 doses, in 2026", RECORD)).toEqual([]);
  });

  it("catches an invented threshold", () => {
    expect(findUngroundedNumbers("notify the physician if SBP rises to 180", RECORD)).toEqual(["180"]);
  });

  it("lists each missing figure once", () => {
    expect(findUngroundedNumbers("GCS 14 then GCS 14 again", RECORD)).toEqual(["14"]);
  });
});

describe("normalizeFlagsResult", () => {
  const good = { title: "BP", detail: "BP 160/90", severity: "HIGH", action: "Discuss with the physician" };

  it("labels the result as an AI draft with the standard notice", () => {
    const r = normalizeFlagsResult({ flags: [good], overallRisk: "HIGH", riskSummary: "x" }, RECORD);
    expect(r.aiDraft).toBe(true);
    expect(r.notice).toBe(FLAG_NOTICE);
  });

  it("rejects replies that are not in the expected shape", () => {
    expect(() => normalizeFlagsResult({ nothing: true })).toThrow(/unexpected format/);
    expect(() => normalizeFlagsResult(null)).toThrow(/unexpected format/);
    expect(() => normalizeFlagsResult({ flags: "no" })).toThrow(/unexpected format/);
  });

  it("drops flags with no title and keeps at most five", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...good, title: `Flag ${i}` }));
    const r = normalizeFlagsResult({ flags: [{ detail: "no title" }, ...many], overallRisk: "HIGH" }, RECORD);
    expect(r.flags).toHaveLength(5);
    expect(r.flags.every((f) => f.title)).toBe(true);
  });

  it("fixes an unknown severity to WATCH", () => {
    const r = normalizeFlagsResult({ flags: [{ ...good, severity: "EXTREME" }] }, RECORD);
    expect(r.flags[0].severity).toBe("WATCH");
  });

  it("never rates the patient lower than the most severe flag", () => {
    const r = normalizeFlagsResult({ flags: [{ ...good, severity: "CRITICAL" }], overallRisk: "LOW" }, RECORD);
    expect(r.overallRisk).toBe("CRITICAL");
  });

  it("keeps a higher overall rating given by the AI", () => {
    const r = normalizeFlagsResult({ flags: [{ ...good, severity: "WATCH" }], overallRisk: "HIGH" }, RECORD);
    expect(r.overallRisk).toBe("HIGH");
  });

  it("attaches the figures that are not in the record to the flag", () => {
    const r = normalizeFlagsResult(
      { flags: [{ ...good, detail: "Creatinine 185 (about 2.09 mg/dL)", action: "Notify if SBP over 180" }] },
      RECORD
    );
    expect(r.flags[0].unverifiedNumbers).toEqual(["2.09", "180"]);
  });

  it("adds no warning when every figure is in the record", () => {
    const r = normalizeFlagsResult({ flags: [good] }, RECORD);
    expect(r.flags[0].unverifiedNumbers).toBeUndefined();
  });
});

describe("predict-flags handler", () => {
  const body = { extracted: { name: "TEST PATIENT", currentDiagnosis: "Hypertensive emergency", vitals: { bp: "160/90" } }, filteredText: RECORD };

  async function run(b, opts) {
    const res = makeRes();
    await handler(makeReq(b, opts), res);
    return res;
  }

  it("rejects non-POST and missing data", async () => {
    mockGroq();
    expect((await run(undefined, { method: "GET" })).statusCode).toBe(405);
    expect((await run({})).statusCode).toBe(400);
  });

  it("returns labelled flags and marks figures that are not in the record", async () => {
    const reply = JSON.stringify({
      flags: [{ title: "Renal", detail: "eGFR 29, creatinine about 2.09 mg/dL", severity: "WATCH", action: "Discuss with the physician" }],
      overallRisk: "LOW",
      riskSummary: "Summary",
    });
    mockGroq({}, ok(reply));
    const res = await run(body);
    expect(res.statusCode).toBe(200);
    expect(res.json.aiDraft).toBe(true);
    expect(res.json.notice).toBe(FLAG_NOTICE);
    expect(res.json.flags[0].unverifiedNumbers).toEqual(["2.09"]);
  });

  it("tells the AI not to invent thresholds, orders or numbers", async () => {
    const { calls } = mockGroq({}, ok(JSON.stringify({ flags: [{ title: "T", detail: "d", severity: "WATCH", action: "a" }] })));
    await run(body);
    const prompt = calls[0].messages[0].content;
    expect(prompt).toMatch(/Do NOT invent numeric thresholds/);
    expect(prompt).toMatch(/Never convert units/);
    expect(prompt).toMatch(/Never tell the nurse to start, stop, hold or change a medication/);
    expect(prompt).toMatch(/escalate per your unit's protocol/);
    expect(prompt).not.toMatch(/exact threshold that triggers escalation/);
  });

  it("returns a JSON error when the AI reply is unusable", async () => {
    mockGroq({}, ok(JSON.stringify({ unexpected: true })));
    const res = await run(body);
    expect(res.statusCode).toBe(500);
    expect(res.json.error).toMatch(/unexpected format/);
  });

  it("returns a JSON error when the AI service fails", async () => {
    mockGroq({}, fail(401, "invalid_api_key", "Invalid API Key"));
    const res = await run(body);
    expect(res.statusCode).toBe(500);
    expect(res.json.error).toMatch(/Invalid API Key/);
  });
});
