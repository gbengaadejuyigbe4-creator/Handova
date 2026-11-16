import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SpecialistSection, { SpecialistResults, requestSpecialist } from "../src/components/SpecialistSection.tsx";
import { PerspectiveCard } from "../src/components/ClinicianDemo.tsx";
import { buildSnapshot, normalizeSpecialistResult, selectLenses, SPECIALIST_DISCLAIMER } from "../api/_specialist.js";

// All invented.
const INPUT = {
  extracted: {
    name: "TESTER, DEMO PERSON",
    age: "58",
    gender: "Male",
    currentDiagnosis: "Decompensated heart failure",
    medsAdministered: "IV furosemide 40 mg BD",
    vitals: { bp: "150/90", pulse: "96", spo2: "93%" },
  },
  filteredText: "Creatinine 168 umol/L\nUrine output not recorded",
};

const realOutput = () => {
  const snap = buildSnapshot(INPUT);
  const lenses = selectLenses(snap);
  const raw = {
    perspectives: lenses.map((l) => ({
      specialty: l.key,
      headline: `${l.label} view`,
      interpretations: [{ text: "Pulse 96 could suggest strain. Creatinine of about 1.9 mg/dL may matter.", basis: ["F1"] }],
      evidenceGaps: [
        { missing: "Urine output", state: "not_documented", why: "Shows diuretic response", limitation: "Response unknown", nextStep: "clarify_record", urgency: "soon", basis: [] },
      ],
      management: [{ text: "Give IV fluids now", basis: [] }, { text: "Consider asking about the diuretic dose", basis: [] }],
    })),
  };
  const result = normalizeSpecialistResult(raw, snap, lenses, new Date("2026-11-16T10:00:00Z"));
  return { ...result, snapshot: { facts: snap.facts, lines: snap.lines } };
};

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const nonJson = (status) => ({ ok: false, status, json: async () => { throw new Error("not json"); } });

describe("requestSpecialist", () => {
  const payload = { extracted: INPUT.extracted, filteredText: "x" };

  it("returns the data on success and posts to /api/specialist", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { perspectives: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestSpecialist(payload)).resolves.toEqual({ perspectives: [] });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/specialist");
  });

  it("shows the server's own error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { error: "Specialist pipeline failed: boom" })));
    await expect(requestSpecialist(payload)).rejects.toThrow("Specialist pipeline failed: boom");
  });

  it.each([
    [504, /took too long/],
    [408, /took too long/],
    [502, /server had a problem \(error 502\)/],
  ])("gives a clear message for a non-JSON %i reply", async (status, pattern) => {
    vi.stubGlobal("fetch", vi.fn(async () => nonJson(status)));
    await expect(requestSpecialist(payload)).rejects.toThrow(pattern);
  });
});

describe("SpecialistResults (real pipeline output)", () => {
  const data = realOutput();
  const html = renderToStaticMarkup(createElement(SpecialistResults, { data }));

  it("puts the disclaimer on every card", () => {
    const count = html.split(SPECIALIST_DISCLAIMER.replace(/'/g, "&#x27;")).length - 1;
    expect(data.perspectives.length).toBeGreaterThan(0);
    expect(count).toBe(data.perspectives.length);
  });

  it("shows the standing notice and says suggestions are read-only here", () => {
    expect(html).toContain("These are AI-generated suggestions, not a specialist consultation");
    expect(html).toContain("Read-only here");
  });

  it("offers no decision buttons on a real patient", () => {
    expect(html).not.toMatch(/>Accept</);
    expect(html).not.toMatch(/>Defer</);
    expect(html).not.toMatch(/>Reject</);
  });

  it("shows a warning for a figure that is not in the record", () => {
    expect(html).toContain("Figures not found in the record: 1.9");
  });

  it("does not show the item that was worded as an order, and says something was removed", () => {
    expect(html).not.toContain("Give IV fluids now");
    expect(html).toContain("Consider asking about the diuretic dose");
    expect(html).toMatch(/Safety checks removed \d+ item/);
  });

  it("explains why each specialty was chosen", () => {
    expect(html).toContain("matched:");
  });

  it("never contains the patient's name", () => {
    expect(html).not.toMatch(/TESTER/i);
  });

  it("says plainly when nothing passed the checks", () => {
    const empty = { ...data, perspectives: [] };
    const out = renderToStaticMarkup(createElement(SpecialistResults, { data: empty }));
    expect(out).toContain("No suggestions passed the safety checks");
    expect(out).toContain("says nothing about the patient");
  });
});

describe("PerspectiveCard in viewer mode", () => {
  const { perspectives, snapshot } = realOutput();
  it("still shows the disclaimer and the AI-generated label", () => {
    const out = renderToStaticMarkup(createElement(PerspectiveCard, { p: perspectives[0], facts: snapshot.facts, role: "viewer" }));
    expect(out).toContain("Not a diagnosis, not an order");
    expect(out).toContain("AI-generated suggestion");
  });
});

describe("SpecialistSection", () => {
  it("starts with a button and an explanation, and runs nothing by itself", () => {
    const html = renderToStaticMarkup(createElement(SpecialistSection, { extracted: { extracted: INPUT.extracted } }));
    expect(html).toContain("Specialist perspectives (AI suggestions)");
    expect(html).toContain("Not orders");
    expect(html).not.toContain("Not a diagnosis");
  });

  it("shows nothing when there is no extracted patient", () => {
    expect(renderToStaticMarkup(createElement(SpecialistSection, { extracted: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(SpecialistSection, { extracted: {} }))).toBe("");
  });
});
