import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ClinicianDemo, { PerspectiveCard } from "../src/components/ClinicianDemo.tsx";
import { DEMO_DISCLAIMER, DEMO_PATIENTS } from "../src/demo/clinicianDemoData.ts";
import { GAP_STATES, SPECIALIST_DISCLAIMER, isOrderLikeWording } from "../api/_specialist.js";

const allPerspectives = DEMO_PATIENTS.flatMap((p) => p.perspectives.map((x) => ({ patient: p, p: x })));
const itemsOf = (p) => [p.interpretations, p.differentials, p.risks, p.monitoring, p.management, p.escalation].flat();

describe("clinician demo data", () => {
  it("uses the same disclaimer wording as the server pipeline", () => {
    expect(DEMO_DISCLAIMER).toBe(SPECIALIST_DISCLAIMER);
  });

  it("puts the disclaimer and awaiting-review status on every perspective", () => {
    for (const { p } of allPerspectives) {
      expect(p.disclaimer).toBe(SPECIALIST_DISCLAIMER);
      expect(p.reviewStatus).toBe("awaiting_medical_review");
    }
  });

  it("only cites facts that exist for that patient", () => {
    for (const { patient, p } of allPerspectives) {
      const ids = new Set(patient.facts.map((f) => f.id));
      const cited = [...itemsOf(p).flatMap((i) => i.basis), ...p.evidenceGaps.flatMap((g) => g.basis)];
      for (const id of cited) expect(ids.has(id), `${patient.label} cites ${id}`).toBe(true);
    }
  });

  it("shows all six evidence-gap states across the demo", () => {
    const used = new Set(allPerspectives.flatMap(({ p }) => p.evidenceGaps.map((g) => g.state)));
    for (const s of GAP_STATES) expect(used.has(s), `missing state ${s}`).toBe(true);
  });

  it("contains no wording that reads as an order", () => {
    for (const { p } of allPerspectives) {
      for (const it of itemsOf(p)) expect(isOrderLikeWording(it.text), it.text).toBe(false);
      for (const g of p.evidenceGaps) {
        for (const t of [g.missing, g.why, g.limitation]) expect(isOrderLikeWording(t), t).toBe(false);
      }
    }
  });

  it("is clearly fake", () => {
    expect(DEMO_PATIENTS.every((p) => /^Demo Patient/.test(p.label))).toBe(true);
  });
});

describe("PerspectiveCard", () => {
  const { patient, p } = allPerspectives[0];
  const render = (props) => renderToStaticMarkup(createElement(PerspectiveCard, { p, facts: patient.facts, ...props }));

  it("always shows the disclaimer and the AI-generated label, for doctors and nurses", () => {
    for (const role of ["doctor", "nurse"]) {
      const html = render({ role });
      expect(html).toContain(SPECIALIST_DISCLAIMER.replace(/'/g, "&#x27;"));
      expect(html).toContain("AI-generated suggestion");
    }
  });

  it("shows the disclaimer even after a decision has been made", () => {
    const html = render({ role: "nurse", decision: { decision: "accepted", reason: "" } });
    expect(html).toContain("Not a diagnosis, not an order");
  });

  it("gives the doctor Accept, Defer and Reject, with the reason optional", () => {
    const html = render({ role: "doctor" });
    expect(html).toContain("Accept");
    expect(html).toContain("Defer");
    expect(html).toContain("Reject");
    expect(html).toContain("Reason (optional, never required)");
  });

  it("gives nurses no decision buttons and says it is awaiting medical review", () => {
    const html = render({ role: "nurse" });
    expect(html).not.toMatch(/>Accept</);
    expect(html).not.toMatch(/>Defer</);
    expect(html).not.toMatch(/>Reject</);
    expect(html).toContain("Awaiting medical review");
  });

  it("shows nurses the doctor's decision once made, still read-only", () => {
    const html = render({ role: "nurse", decision: { decision: "rejected", reason: "Not relevant" } });
    expect(html).toContain("Rejected (not adopted)");
    expect(html).not.toMatch(/>Undo</);
  });

  it("never mentions orders or tasks being created", () => {
    const html = render({ role: "doctor" });
    expect(html).toContain("Nothing here becomes an order or a task");
  });
});

describe("ClinicianDemo screen", () => {
  it("opens with the demo banner and the patient list", () => {
    const html = renderToStaticMarkup(createElement(ClinicianDemo));
    expect(html).toContain("DEMO. Invented patients. Nothing is saved or sent anywhere");
    expect(html).toContain("Demo Patient A");
    expect(html).toContain("Demo Patient C");
  });
});
