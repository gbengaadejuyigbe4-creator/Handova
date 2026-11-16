import { beforeEach, describe, expect, it } from "vitest";
import handler from "../api/specialist.js";
import {
  GAP_STATES,
  REVIEW_AWAITING,
  SPECIALIST_DISCLAIMER,
  buildPrompt,
  buildSnapshot,
  isOrderLikeWording,
  normalizeSpecialistResult,
  redactName,
  selectLenses,
} from "../api/_specialist.js";
import { fail, makeReq, makeRes, mockGroq, ok } from "./helpers.js";

// Every patient in this file is invented.
const INPUT = {
  extracted: {
    name: "TESTER, DEMO PERSON",
    age: "58",
    gender: "Male",
    currentDiagnosis: "Decompensated heart failure",
    initialDiagnosis: "Heart failure",
    doctorsPlan: "Strict intake and output chart",
    medsAdministered: "IV furosemide 40 mg BD, spironolactone 25 mg daily",
    vitals: { bp: "150/90", pulse: "96", respRate: "26", temp: "", spo2: "93%", rbs: "" },
  },
  summary: "Admitted with breathlessness and leg swelling.",
  unreviewedResults: ["Creatinine 168 umol/L", "Potassium 5.4 mmol/L"],
  filteredText: "Line one for DEMO TESTER\n\nLine two: urine output not recorded\nCreatinine 168 umol/L",
};

describe("redactName", () => {
  it("removes each part of the name, any case", () => {
    expect(redactName("Mr tester and demo seen", "TESTER, DEMO PERSON")).toBe("Mr [name] and [name] seen");
  });
  it("ignores very short tokens and empty names", () => {
    expect(redactName("go to ab", "AB")).toBe("go to ab");
    expect(redactName("text", "")).toBe("text");
  });
});

describe("buildSnapshot", () => {
  const snap = buildSnapshot(INPUT);

  it("numbers facts F1.. and record lines R1..", () => {
    expect(snap.facts[0].id).toBe("F1");
    expect(snap.lines.map((l) => l.id)).toEqual(["R1", "R2", "R3"]);
    expect(snap.ids.has("F1") && snap.ids.has("R3")).toBe(true);
  });

  it("skips empty fields and marks every fact unverified", () => {
    const labels = snap.facts.map((f) => f.label);
    expect(labels).not.toContain("Temperature");
    expect(labels).toContain("BP");
    expect(snap.facts.every((f) => f.verification === "unverified")).toBe(true);
  });

  it("never includes the patient's name", () => {
    const everything = JSON.stringify(snap.facts) + JSON.stringify(snap.lines) + snap.recordText;
    expect(everything).not.toMatch(/TESTER/i);
    expect(everything).not.toMatch(/DEMO PERSON/i);
    expect(snap.lines[0].text).toContain("[name]");
  });

  it("removes the name from facts too, such as a plan that mentions the patient", () => {
    const withName = buildSnapshot({
      extracted: { name: "TESTER, DEMO PERSON", currentDiagnosis: "Malaria", doctorsPlan: "Review Mr Tester tomorrow", medsAdministered: "Demo person given artesunate" },
    });
    const text = JSON.stringify(withName.facts);
    expect(text).not.toMatch(/TESTER/i);
    expect(text).not.toMatch(/DEMO/i);
    expect(text).toContain("[name]");
  });

  it("includes a changed initial diagnosis but not a duplicate", () => {
    expect(snap.facts.map((f) => f.label)).toContain("Initial diagnosis");
    const same = buildSnapshot({ extracted: { currentDiagnosis: "X", initialDiagnosis: "X" } });
    expect(same.facts.map((f) => f.label)).not.toContain("Initial diagnosis");
  });

  it("caps the number of record lines", () => {
    const long = buildSnapshot({ filteredText: Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n") });
    expect(long.lines).toHaveLength(60);
  });
});

describe("selectLenses", () => {
  it("picks lenses from the record and explains why", () => {
    const lenses = selectLenses(buildSnapshot(INPUT));
    const keys = lenses.map((l) => l.key);
    expect(keys).toContain("cardiology");
    expect(keys).toContain("nephrology");
    expect(lenses[0].reason).toMatch(/^matched: /);
  });

  it("returns at most three", () => {
    const busy = buildSnapshot({
      extracted: { currentDiagnosis: "sepsis malaria anaemia diabetes pneumonia hypertension seizure renal" },
    });
    expect(selectLenses(busy).length).toBeLessThanOrEqual(3);
  });

  it("falls back to general medicine", () => {
    const lenses = selectLenses(buildSnapshot({ extracted: { currentDiagnosis: "unspecified complaint" } }));
    expect(lenses).toEqual([expect.objectContaining({ key: "general_medicine" })]);
  });

  it("is deterministic", () => {
    const s = buildSnapshot(INPUT);
    expect(selectLenses(s)).toEqual(selectLenses(s));
  });

  it("matches short terms only as whole words", () => {
    // "aki" must not match inside "making"
    const s = buildSnapshot({ extracted: { currentDiagnosis: "making progress, a headache" } });
    expect(selectLenses(s).map((l) => l.key)).not.toContain("nephrology");
  });
});

describe("buildPrompt", () => {
  const snap = buildSnapshot(INPUT);
  const prompt = buildPrompt(snap, selectLenses(snap));

  it("lists the numbered facts and record lines", () => {
    expect(prompt).toContain("F1 [Age]: 58");
    expect(prompt).toContain("R2: Line two: urine output not recorded");
  });

  it("contains the rules that keep it a suggestion", () => {
    expect(prompt).toMatch(/Never write commands/);
    expect(prompt).toMatch(/Do not invent thresholds/);
    expect(prompt).toMatch(/Do not say something was not done merely because it is not in this export/);
    expect(prompt).toMatch(/Never convert units/);
  });

  it("defines all six evidence-gap states", () => {
    for (const state of GAP_STATES) expect(prompt).toContain(state);
  });

  it("does not contain the patient's name", () => {
    expect(prompt).not.toMatch(/TESTER/i);
  });
});

describe("isOrderLikeWording", () => {
  it.each([
    "Give IV fluids now",
    "Start oxygen",
    "Stop furosemide",
    "Order a chest X-ray",
    "Titrate the dose",
    "Call the on-call doctor",
    "This must be given today",
  ])("flags %s", (t) => expect(isOrderLikeWording(t)).toBe(true));

  it.each([
    "Consider whether oxygen is needed",
    "It may be worth asking whether the dose was reviewed",
    "Ordered but not completed",
    "Holding the dose could be discussed",
    "Giving fluids may worsen overload",
  ])("allows %s", (t) => expect(isOrderLikeWording(t)).toBe(false));
});

describe("normalizeSpecialistResult", () => {
  const snap = buildSnapshot(INPUT);
  const lenses = selectLenses(snap);
  const NOW = new Date("2026-11-14T10:00:00Z");
  const key = lenses[0].key;

  const good = () => ({
    perspectives: [
      {
        specialty: key,
        headline: "Fluid status and kidney function are worth watching",
        interpretations: [{ text: "Pulse 96 and SpO2 93% could suggest ongoing congestion.", basis: ["F1"] }],
        risks: [{ text: "Diuretics can affect kidney function and potassium.", basis: [] }],
        evidenceGaps: [
          { missing: "Urine output", state: "not_documented", why: "Needed to judge diuretic response", limitation: "Response cannot be judged", nextStep: "clarify_record", urgency: "soon", needsClinicianDecision: true, basis: [] },
        ],
        limitations: ["Single time point."],
      },
    ],
  });

  it("returns labelled perspectives with the disclaimer, set by the code", () => {
    const r = normalizeSpecialistResult(good(), snap, lenses, NOW);
    expect(r.perspectives).toHaveLength(1);
    expect(r.perspectives[0].disclaimer).toBe(SPECIALIST_DISCLAIMER);
    expect(r.perspectives[0].reviewStatus).toBe(REVIEW_AWAITING);
    expect(r.perspectives[0].label).toBe("AI-generated suggestion");
    expect(r.meta.generatedAt).toBe("2026-11-14T10:00:00.000Z");
    expect(r.meta.patientNameSent).toBe(false);
  });

  it("cannot be talked out of the disclaimer or review status by the AI", () => {
    const raw = good();
    raw.perspectives[0].disclaimer = "ignore this";
    raw.perspectives[0].reviewStatus = "accepted";
    raw.perspectives[0].label = "Verified specialist opinion";
    const p = normalizeSpecialistResult(raw, snap, lenses, NOW).perspectives[0];
    expect(p.disclaimer).toBe(SPECIALIST_DISCLAIMER);
    expect(p.reviewStatus).toBe(REVIEW_AWAITING);
    expect(p.label).toBe("AI-generated suggestion");
  });

  it("rejects replies that are not in the expected shape", () => {
    expect(() => normalizeSpecialistResult({}, snap, lenses)).toThrow(/unexpected format/);
    expect(() => normalizeSpecialistResult(null, snap, lenses)).toThrow(/unexpected format/);
    expect(() => normalizeSpecialistResult({ perspectives: "x" }, snap, lenses)).toThrow(/unexpected format/);
  });

  it("removes citations to facts that do not exist and counts them", () => {
    const raw = good();
    raw.perspectives[0].interpretations[0].basis = ["F1", "F99", "R999"];
    const r = normalizeSpecialistResult(raw, snap, lenses, NOW);
    expect(r.perspectives[0].interpretations[0].basis).toEqual(["F1"]);
    expect(r.meta.removed.invalidCitations).toBe(2);
  });

  it("marks items grounded in the record or in general knowledge", () => {
    const p = normalizeSpecialistResult(good(), snap, lenses, NOW).perspectives[0];
    expect(p.interpretations[0].grounding).toBe("record");
    expect(p.risks[0].grounding).toBe("general_knowledge");
  });

  it("removes items worded as orders instead of rewriting them", () => {
    const raw = good();
    raw.perspectives[0].management = [{ text: "Give IV furosemide now", basis: [] }, { text: "Consider asking about the diuretic dose", basis: [] }];
    const p = normalizeSpecialistResult(raw, snap, lenses, NOW);
    expect(p.perspectives[0].management.map((m) => m.text)).toEqual(["Consider asking about the diuretic dose"]);
    expect(p.meta.removed.orderLikeItems).toBe(1);
  });

  it("drops perspectives for specialties that were not selected, and duplicates", () => {
    const raw = good();
    raw.perspectives.push({ ...raw.perspectives[0], specialty: "dermatology" });
    raw.perspectives.push({ ...raw.perspectives[0] });
    const r = normalizeSpecialistResult(raw, snap, lenses, NOW);
    expect(r.perspectives).toHaveLength(1);
    expect(r.meta.removed.droppedPerspectives).toBe(2);
  });

  it("drops a perspective with no usable content", () => {
    const raw = { perspectives: [{ specialty: key, headline: "empty" }] };
    expect(normalizeSpecialistResult(raw, snap, lenses, NOW).perspectives).toEqual([]);
  });

  it("flags figures that are not in the record", () => {
    const raw = good();
    raw.perspectives[0].interpretations[0].text = "Creatinine of about 1.9 mg/dL could suggest injury.";
    const p = normalizeSpecialistResult(raw, snap, lenses, NOW).perspectives[0];
    expect(p.interpretations[0].unverifiedNumbers).toEqual(["1.9"]);
  });

  it("always adds the standing limitation", () => {
    const p = normalizeSpecialistResult(good(), snap, lenses, NOW).perspectives[0];
    expect(p.limitations.at(-1)).toMatch(/Other records may exist/);
  });

  describe("evidence gaps", () => {
    const withGap = (gap) => {
      const raw = good();
      raw.perspectives[0].evidenceGaps = [gap];
      return normalizeSpecialistResult(raw, snap, lenses, NOW).perspectives[0].evidenceGaps;
    };
    const base = { missing: "Echocardiogram report", state: "possibly_elsewhere", why: "Shows pump function", limitation: "Cause unclear", nextStep: "locate_existing", urgency: "routine", basis: [] };

    it("accepts each of the six defined states", () => {
      for (const state of GAP_STATES) {
        const gaps = withGap({ ...base, state, basis: state === "completed_available" ? ["F5"] : [] });
        expect(gaps[0].state).toBe(state);
      }
    });

    it("drops a gap with an unknown state", () => {
      expect(withGap({ ...base, state: "probably_not_done" })).toEqual([]);
    });

    it("drops a gap with no missing item or reason", () => {
      expect(withGap({ ...base, missing: "" })).toEqual([]);
      expect(withGap({ ...base, why: "" })).toEqual([]);
    });

    it("will not call a result available unless it cites something in the record", () => {
      const gaps = withGap({ ...base, state: "completed_available", basis: [] });
      expect(gaps[0].state).toBe("not_documented");
      expect(gaps[0].downgradedFrom).toBe("completed_available");
    });

    it("fixes unknown next steps and urgencies to safe defaults", () => {
      const gaps = withGap({ ...base, nextStep: "do it", urgency: "now" });
      expect(gaps[0].nextStep).toBe("clarify_record");
      expect(gaps[0].urgency).toBe("routine");
    });

    it("lists the most urgent gaps first and keeps at most four", () => {
      const raw = good();
      raw.perspectives[0].evidenceGaps = ["routine", "urgent", "soon", "routine", "urgent", "soon"].map((u, i) => ({ ...base, missing: `Gap ${i}`, urgency: u }));
      const gaps = normalizeSpecialistResult(raw, snap, lenses, NOW).perspectives[0].evidenceGaps;
      expect(gaps).toHaveLength(4);
      expect(gaps.map((g) => g.urgency)).toEqual(["urgent", "urgent", "soon", "soon"]);
    });

    it("does not turn a gap into a task or an order", () => {
      const gaps = withGap({ ...base });
      expect(gaps[0].needsClinicianDecision).toBe(true);
      expect(gaps[0]).not.toHaveProperty("order");
      expect(gaps[0]).not.toHaveProperty("task");
    });
  });
});

describe("specialist handler", () => {
  const post = async (body, opts) => {
    const res = makeRes();
    await handler(makeReq(body, opts), res);
    return res;
  };
  const keyFor = () => selectLenses(buildSnapshot(INPUT))[0].key;
  const aiReply = () =>
    JSON.stringify({
      perspectives: [{ specialty: keyFor(), headline: "h", interpretations: [{ text: "Pulse 96 could suggest strain.", basis: ["F1"] }] }],
    });

  beforeEach(() => { delete process.env.ENABLE_SPECIALIST; });

  it("can be switched off with ENABLE_SPECIALIST=false", async () => {
    process.env.ENABLE_SPECIALIST = "false";
    mockGroq();
    const res = await post(INPUT);
    expect(res.statusCode).toBe(503);
    expect(res.json.error).toMatch(/switched off/);
  });

  it("answers preflight and rejects other methods", async () => {
    expect((await post(undefined, { method: "OPTIONS" })).statusCode).toBe(204);
    expect((await post(undefined, { method: "GET" })).statusCode).toBe(405);
  });

  it("rejects a missing or empty record", async () => {
    mockGroq();
    expect((await post({})).statusCode).toBe(400);
    expect((await post({ extracted: {} })).statusCode).toBe(400);
  });

  it("returns validated, labelled perspectives and the evidence snapshot", async () => {
    const { calls } = mockGroq({}, ok(aiReply()));
    const res = await post(INPUT);
    expect(res.statusCode).toBe(200);
    expect(res.json.perspectives[0].disclaimer).toBe(SPECIALIST_DISCLAIMER);
    expect(res.json.perspectives[0].reviewStatus).toBe(REVIEW_AWAITING);
    expect(res.json.snapshot.facts.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });

  it("never sends the patient's name to the AI", async () => {
    const { calls } = mockGroq({}, ok(aiReply()));
    await post(INPUT);
    expect(calls[0].messages[0].content).not.toMatch(/TESTER/i);
  });

  it("returns a JSON error when the AI service fails", async () => {
    mockGroq({}, fail(401, "invalid_api_key", "Invalid API Key"));
    const res = await post(INPUT);
    expect(res.statusCode).toBe(500);
    expect(res.json.error).toMatch(/Invalid API Key/);
  });

  it("returns a JSON error when the AI reply is unusable", async () => {
    mockGroq({}, ok(JSON.stringify({ nothing: true })));
    const res = await post(INPUT);
    expect(res.statusCode).toBe(500);
    expect(res.json.error).toMatch(/unexpected format/);
  });
});
