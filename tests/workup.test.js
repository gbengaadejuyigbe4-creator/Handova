import { describe, expect, it } from "vitest";
import {
  AUDIENCES, MAX_ROUNDS, MAX_OPEN_PER_AUDIENCE, WORKUP_NOTICE,
  scrubFreeText, findUngroundedDosing, normalizeCapabilities, tagAvailability,
  newWorkup, recordAnswer, canRunRound, applyRound, openQuestions,
  buildWorkupSnapshot, buildWorkupPrompt, normalizeWorkupResult, runWorkupRound, similarQuestions,
} from "../api/_workup.js";
import { SPECIALIST_DISCLAIMER, REVIEW_AWAITING, selectLenses } from "../api/_specialist.js";

// ---- An invented patient. No real data. ------------------------------------------------
const RECORD = {
  extracted: {
    name: "Adaeze Demo",
    age: "58",
    gender: "male",
    currentDiagnosis: "Decompensated heart failure",
    doctorsPlan: "Furosemide 40 mg IV bd; strict intake and output chart",
    medsAdministered: "Furosemide 40 mg",
    vitals: { bp: "150/90", pulse: "112", respRate: "26", temp: "37.2", spo2: "91%" },
  },
  summary: "",
  unreviewedResults: [],
  filteredText: "Admitted with breathlessness\nBilateral leg swelling noted\nOxygen via face mask",
};

const NOW = new Date("2026-11-25T10:00:00Z");
const fresh = () => newWorkup("P-1", NOW);
const snapOf = (workup = fresh()) => buildWorkupSnapshot(RECORD, workup);
const lenses = () => selectLenses(snapOf());
const idOf = (label) => snapOf().facts.find((f) => f.label === label).id;

const q = (over = {}) => ({
  audience: "nurse",
  kind: "observation",
  text: "Can the patient lie flat without becoming breathless?",
  why: "Helps tell how much fluid is on the lungs",
  answerType: "yes_no",
  priority: "soon",
  impact: "high",
  basis: ["F1"],
  ...over,
});

const reply = (over = {}) => ({
  questions: [q()],
  picture: {
    headline: "Heart failure with ongoing breathlessness",
    possibilities: [{ text: "Fluid overload could be contributing", for: ["F1"], against: [] }],
    tests: [{ investigation: "ECG", text: "An ECG may be worth considering", why: "Pulse is fast", basis: ["F1"] }],
    assessments: [{ text: "Worth asking about the weight trend", why: "Fluid balance", basis: ["F1"] }],
    insights: [{ text: "Breathlessness and swelling are both documented", basis: ["R1"] }],
    unresolved: ["Fluid balance totals are not documented"],
    limitations: [],
  },
  ...over,
});

const run = (raw, workup = fresh(), extra = {}) =>
  normalizeWorkupResult(raw, snapOf(workup), { workup, lenses: lenses(), now: NOW, ...extra });

// ---------------------------------------------------------------------------------------
describe("free text from people", () => {
  it("removes the patient's name", () => {
    expect(scrubFreeText("Adaeze says it hurts", "Adaeze Demo")).toBe("[name] says it hurts");
  });
  it("removes phone-like numbers and long digit strings", () => {
    const out = scrubFreeText("call 08031234567 or +234 803 123 4567 or 12345678901", "");
    expect(out).not.toMatch(/\d{7}/);
    expect(out).toContain("[number removed]");
  });
  it("keeps clinical figures", () => {
    expect(scrubFreeText("temp 38.5, BP 90/60, pulse 118", "")).toBe("temp 38.5, BP 90/60, pulse 118");
  });
  it("caps the length", () => {
    expect(scrubFreeText("a".repeat(900), "").length).toBe(300);
  });
});

describe("dose and frequency wording", () => {
  const rec = "Furosemide 40 mg IV bd. SpO2 91%. Potassium 3.1 mmol/L";
  it("flags a dose that is not in the record", () => {
    expect(findUngroundedDosing("Consider 80 mg", rec)).toEqual(["80 mg"]);
  });
  it("allows a dose copied from the record, however it is spaced", () => {
    expect(findUngroundedDosing("The recorded 40mg dose", rec)).toEqual([]);
    expect(findUngroundedDosing("The recorded 40 mg dose", rec)).toEqual([]);
  });
  it("flags frequencies that are not in the record and allows those that are", () => {
    expect(findUngroundedDosing("give tds", rec)).toEqual(["tds"]);
    expect(findUngroundedDosing("every 4 hours", rec)).toEqual(["every 4 hours"]);
    expect(findUngroundedDosing("twice as bd in the record", rec)).toEqual([]);
  });
  it("does not mistake lab values and saturations for doses", () => {
    expect(findUngroundedDosing("SpO2 94% and potassium 2.9 mmol/L", rec)).toEqual([]);
  });
});

describe("hospital test list", () => {
  const caps = normalizeCapabilities([
    { name: "ECG", status: "available" },
    { name: "CT scan", aliases: ["CT"], status: "not_available" },
    { name: "Troponin", status: "maybe" },
    { name: "  " },
  ]);
  it("drops empty names and turns invalid statuses into unknown", () => {
    expect(caps.map((c) => c.name)).toEqual(["ECG", "CT scan", "Troponin"]);
    expect(caps[2].status).toBe("unknown");
  });
  it("tags from the list, by name or alias", () => {
    expect(tagAvailability("12-lead ECG", caps).availability).toBe("available");
    expect(tagAvailability("CT head", caps).availability).toBe("not_available");
  });
  it("says unknown when nothing matches", () => {
    expect(tagAvailability("Echocardiogram", caps)).toEqual({ availability: "unknown", matched: null });
    expect(tagAvailability("anything", [])).toEqual({ availability: "unknown", matched: null });
  });
  it("matches whole words only", () => {
    expect(tagAvailability("doctor review", caps).availability).toBe("unknown"); // "ct" sits inside "doctor"
  });
  it("says unknown when matches disagree", () => {
    expect(tagAvailability("ECG then CT", caps).availability).toBe("unknown");
  });
});

describe("workup state", () => {
  const withQuestions = () => {
    const w = fresh();
    const r = run(reply({ questions: [q(), q({ audience: "doctor", kind: "history", text: "Is there a past history of heart disease?", basis: ["F2"] })] }), w);
    return applyRound(w, r);
  };

  it("starts empty with an opaque reference", () => {
    const w = fresh();
    expect(w).toMatchObject({ round: 0, questions: [], answers: [], picture: null, patientRef: "P-1" });
  });

  it("records an answer, scrubs it, and closes the question", () => {
    const w = recordAnswer(withQuestions(), { questionId: "Q1", value: "Yes, Adaeze is fine lying flat", by: "nurse", patientName: "Adaeze Demo" });
    expect(w.answers[0]).toMatchObject({ id: "A1", questionId: "Q1", status: "answered", by: "nurse" });
    expect(w.answers[0].value).not.toContain("Adaeze");
    expect(w.questions.find((x) => x.id === "Q1").status).toBe("answered");
  });

  it("records an empty answer as unknown rather than as an empty fact", () => {
    const w = recordAnswer(withQuestions(), { questionId: "Q1", value: "   " });
    expect(w.answers[0].status).toBe("unknown");
    expect(w.answers[0].value).toBe("");
  });

  it("keeps an unknown and a not-available answer without a value", () => {
    let w = recordAnswer(withQuestions(), { questionId: "Q1", status: "not_available", value: "ignored" });
    expect(w.answers[0].value).toBe("");
    w = recordAnswer(w, { questionId: "Q2", status: "unknown" });
    expect(openQuestions(w)).toHaveLength(0);
  });

  it("treats a role it does not know as unverified", () => {
    const w = recordAnswer(withQuestions(), { questionId: "Q1", value: "yes", by: "administrator" });
    expect(w.answers[0].by).toBe("unknown");
  });

  it("refuses to answer twice, or to answer a question that does not exist", () => {
    const w = recordAnswer(withQuestions(), { questionId: "Q1", value: "yes" });
    expect(() => recordAnswer(w, { questionId: "Q1", value: "no" })).toThrow();
    expect(() => recordAnswer(w, { questionId: "Q99", value: "no" })).toThrow();
  });

  it("does not change the workup it was given", () => {
    const before = withQuestions();
    const snapshot = JSON.stringify(before);
    recordAnswer(before, { questionId: "Q1", value: "yes" });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("allows round 1 at once, then needs a new answer for each further round", () => {
    expect(canRunRound(fresh()).ok).toBe(true);
    const w = withQuestions();
    expect(canRunRound(w)).toEqual({ ok: false, reason: "no_new_answers" });
    expect(canRunRound(recordAnswer(w, { questionId: "Q1", value: "yes" })).ok).toBe(true);
  });

  it("stops after the last round", () => {
    expect(canRunRound({ ...fresh(), round: MAX_ROUNDS })).toEqual({ ok: false, reason: "max_rounds" });
  });

  it("refuses a result from the wrong round", () => {
    const w = fresh();
    const r = run(reply(), w);
    expect(() => applyRound({ ...w, round: 1 }, r)).toThrow();
  });
});

describe("answers as facts", () => {
  it("numbers answers A1.. and lets them be cited", () => {
    let w = applyRound(fresh(), run(reply(), fresh()));
    w = recordAnswer(w, { questionId: "Q1", value: "Yes, temperature 38.5" });
    const snap = snapOf(w);
    expect(snap.ids.has("A1")).toBe(true);
    expect(snap.answerFacts[0]).toMatchObject({ id: "A1", audience: "nurse", status: "answered" });
  });

  it("counts a figure a clinician typed as grounded", () => {
    let w = applyRound(fresh(), run(reply(), fresh()));
    w = recordAnswer(w, { questionId: "Q1", value: "Urine output 275 over 6 hours" });
    const r = run(reply({ picture: { ...reply().picture, insights: [{ text: "Output of 275 is documented in the answers", basis: ["A1"] }] } }), w);
    expect(r.picture.insights[0].unverifiedNumbers).toBeUndefined();
    // Without the answer, the same figure is flagged.
    const noAnswer = run(reply({ picture: { ...reply().picture, insights: [{ text: "Output of 275 is mentioned", basis: ["F1"] }] } }));
    expect(noAnswer.picture.insights[0].unverifiedNumbers).toEqual(["275"]);
  });
});

describe("what the code sets, not the AI", () => {
  it("sets the disclaimer, notice and review status itself", () => {
    const raw = reply();
    raw.picture.disclaimer = "This is a diagnosis";
    raw.picture.reviewStatus = "approved";
    raw.picture.label = "Verified";
    const r = run(raw);
    expect(r.picture.disclaimer).toBe(SPECIALIST_DISCLAIMER);
    expect(r.picture.reviewStatus).toBe(REVIEW_AWAITING);
    expect(r.picture.label).toBe("AI-generated suggestion");
    expect(r.notice).toBe(WORKUP_NOTICE);
    expect(r.meta.patientNameSent).toBe(false);
  });

  it("labels every possibility as possible, whatever the AI says", () => {
    const raw = reply();
    raw.picture.possibilities[0].certainty = "definite";
    expect(run(raw).picture.possibilities[0].certainty).toBe("possible");
  });

  it("takes test availability from the hospital list, not from the AI", () => {
    const raw = reply();
    raw.picture.tests[0].availability = "available";
    const caps = normalizeCapabilities([{ name: "ECG", status: "not_available" }]);
    expect(run(raw, fresh(), { capabilities: caps }).picture.tests[0].availability).toBe("not_available");
    expect(run(raw).picture.tests[0].availability).toBe("unknown");
  });
});

describe("questions", () => {
  it("keeps a good question and numbers it", () => {
    const r = run(reply());
    expect(r.newQuestions).toHaveLength(1);
    expect(r.newQuestions[0]).toMatchObject({ id: "Q1", status: "open", round: 1, audience: "nurse", basis: ["F1"] });
  });

  it("drops text that is not a question", () => {
    const r = run(reply({ questions: [q({ text: "Check the patient's weight today." })] }));
    expect(r.newQuestions).toHaveLength(0);
    expect(r.meta.removed.notQuestions).toBe(1);
  });

  it("drops a command even when it ends with a question mark", () => {
    const r = run(reply({ questions: [q({ text: "Start oxygen now?" })] }));
    expect(r.newQuestions).toHaveLength(0);
    expect(r.meta.removed.orderLikeItems).toBe(1);
  });

  it("drops a question with no reason, no known audience, or nothing to cite", () => {
    const r = run(reply({ questions: [q({ why: "" }), q({ audience: "pharmacist" }), q({ basis: [] }), q({ basis: ["F999"] })] }));
    expect(r.newQuestions).toHaveLength(0);
    expect(r.meta.removed.noBasis).toBe(2);
    expect(r.meta.removed.invalidCitations).toBe(1);
  });

  it("drops a repeat of a question already asked, even reworded", () => {
    const w = applyRound(fresh(), run(reply(), fresh()));
    const r = run(reply({ questions: [q({ text: "Can the patient lie flat without being breathless?" })] }), w);
    expect(r.newQuestions).toHaveLength(0);
    expect(r.meta.removed.duplicateQuestions).toBe(1);
  });

  it("drops a repeat inside the same reply", () => {
    const r = run(reply({ questions: [q(), q()] }));
    expect(r.newQuestions).toHaveLength(1);
  });

  it("recognises near-identical wording and keeps different questions apart", () => {
    expect(similarQuestions("Is the patient able to lie flat?", "Is the patient able to lie flat")).toBe(true);
    expect(similarQuestions("Is there swelling in the legs?", "What time was the last dose given?")).toBe(false);
  });

  it("drops a question that asks for a dose that is not in the record", () => {
    const r = run(reply({ questions: [q({ text: "Was 80 mg given at the last round?" })] }));
    expect(r.newQuestions).toHaveLength(0);
    expect(r.meta.removed.dosingRemoved).toBe(1);
  });

  it("allows a question that mentions a dose copied from the record", () => {
    const r = run(reply({ questions: [q({ text: "Was the 40 mg furosemide dose given on time?" })] }));
    expect(r.newQuestions).toHaveLength(1);
  });

  it("turns a choice question with fewer than two choices into a text question", () => {
    const r = run(reply({ questions: [q({ answerType: "choice", choices: ["only one"] })] }));
    expect(r.newQuestions[0].answerType).toBe("text");
    expect(r.newQuestions[0].choices).toEqual([]);
  });

  it("keeps a valid choice question", () => {
    const r = run(reply({ questions: [q({ answerType: "choice", choices: ["None", "Mild", "Severe"] })] }));
    expect(r.newQuestions[0].choices).toEqual(["None", "Mild", "Severe"]);
  });

  it("puts urgent questions first, then the highest impact", () => {
    const r = run(reply({
      questions: [
        q({ text: "Is there any chest pain at present?", priority: "routine", impact: "high" }),
        q({ text: "Has the patient passed urine since morning?", priority: "urgent", impact: "low" }),
        q({ text: "Is there swelling in both legs today?", priority: "urgent", impact: "high" }),
      ],
    }));
    expect(r.newQuestions.map((x) => x.text)).toEqual([
      "Is there swelling in both legs today?",
      "Has the patient passed urine since morning?",
      "Is there any chest pain at present?",
    ]);
  });

  it(`never leaves more than ${MAX_OPEN_PER_AUDIENCE} questions open for one audience`, () => {
    const many = Array.from({ length: 8 }, (_, i) => q({ text: `Has symptom number ${["one","two","three","four","five","six","seven","eight"][i]} improved?` }));
    const r = run(reply({ questions: many }));
    expect(r.newQuestions.filter((x) => x.audience === "nurse")).toHaveLength(MAX_OPEN_PER_AUDIENCE);
    expect(r.meta.removed.askedTooMany).toBe(3);
  });

  it("counts questions that are still open against the cap", () => {
    let w = applyRound(fresh(), run(reply({ questions: Array.from({ length: 4 }, (_, i) => q({ text: `Is observation ${["alpha","bravo","charlie","delta"][i]} normal today?` })) }), fresh()));
    expect(openQuestions(w, "nurse")).toHaveLength(4);
    w = recordAnswer(w, { questionId: "Q1", value: "yes" });
    const r = run(reply({ questions: [q({ text: "Is the cough better than yesterday?" }), q({ text: "Is the appetite better than yesterday?" }), q({ text: "Is the sleep better than yesterday?" })] }), w);
    // 3 still open, so only 2 more fit
    expect(r.newQuestions).toHaveLength(2);
  });

  it("continues the numbering across rounds", () => {
    const w = applyRound(fresh(), run(reply(), fresh()));
    const r = run(reply({ questions: [q({ text: "Has the cough changed since admission?" })] }), w);
    expect(r.newQuestions[0].id).toBe("Q2");
    expect(r.round).toBe(2);
  });

  it("flags figures in a question that are not in the record", () => {
    const r = run(reply({ questions: [q({ text: "Was the potassium result of 2.1 seen?" })] }));
    expect(r.newQuestions[0].unverifiedNumbers).toEqual(["2.1"]);
  });
});

describe("the last round", () => {
  it("asks nothing and says how many it dropped", () => {
    const w = { ...fresh(), round: MAX_ROUNDS - 1 };
    const r = run(reply(), w);
    expect(r.round).toBe(MAX_ROUNDS);
    expect(r.questionsAllowed).toBe(false);
    expect(r.newQuestions).toHaveLength(0);
    expect(r.meta.removed.questionsOnLastRound).toBe(1);
    expect(r.picture.headline).toBeTruthy();
  });
});

describe("the working picture", () => {
  it("drops suggestions worded as orders", () => {
    const raw = reply();
    raw.picture.assessments = [{ text: "Administer the next dose now", why: "x", basis: ["F1"] }, { text: "Worth asking about swelling", why: "x", basis: ["F1"] }];
    const r = run(raw);
    expect(r.picture.assessments.map((a) => a.text)).toEqual(["Worth asking about swelling"]);
    expect(r.meta.removed.orderLikeItems).toBe(1);
  });

  it("drops a suggestion that carries dosing not found in the record", () => {
    const raw = reply();
    raw.picture.insights = [{ text: "Consider furosemide 80 mg", basis: ["F1"] }, { text: "Consider furosemide tds", basis: ["F1"] }, { text: "The recorded 40 mg dose is documented", basis: ["F1"] }];
    const r = run(raw);
    expect(r.picture.insights).toHaveLength(1);
    expect(r.meta.removed.dosingRemoved).toBe(2);
  });

  it("drops a suggestion that cites nothing, or only ids that do not exist", () => {
    const raw = reply();
    raw.picture.tests = [{ investigation: "ECG", text: "An ECG", basis: [] }, { investigation: "X-ray", text: "A chest film", basis: ["F404"] }];
    const r = run(raw);
    expect(r.picture.tests).toHaveLength(0);
    expect(r.meta.removed.noBasis).toBe(2);
    expect(r.meta.removed.invalidCitations).toBe(1);
  });

  it("accepts a citation to a clinician's answer only if that answer exists", () => {
    const raw = reply();
    raw.picture.insights = [{ text: "The answer given matters", basis: ["A1"] }];
    expect(run(raw).picture.insights).toHaveLength(0);
    const w = recordAnswer(applyRound(fresh(), run(reply(), fresh())), { questionId: "Q1", value: "yes" });
    expect(run(raw, w).picture.insights).toHaveLength(1);
  });

  it("drops a possibility that states a diagnosis as established, or cites nothing", () => {
    const raw = reply();
    raw.picture.possibilities = [
      { text: "The diagnosis is heart failure", for: ["F1"], against: [] },
      { text: "It is definitely fluid overload", for: ["F1"], against: [] },
      { text: "Anaemia could be contributing", for: [], against: [] },
      { text: "A chest infection could be contributing", for: ["F1"], against: ["R1"] },
    ];
    const r = run(raw);
    expect(r.picture.possibilities.map((p) => p.text)).toEqual(["A chest infection could be contributing"]);
    expect(r.meta.removed.certaintyRemoved).toBe(2);
  });

  it("flags a figure that is in neither the record nor the answers", () => {
    const raw = reply();
    raw.picture.insights = [{ text: "A potassium of 2.1 would matter", basis: ["F1"] }];
    expect(run(raw).picture.insights[0].unverifiedNumbers).toEqual(["2.1"]);
  });

  it("keeps the list of unresolved items short and free of orders", () => {
    const raw = reply();
    raw.picture.unresolved = ["Start fluids", ...Array.from({ length: 8 }, (_, i) => `Gap ${i + 1} is not documented`)];
    const r = run(raw);
    expect(r.picture.unresolved).toHaveLength(5);
    expect(r.picture.unresolved).not.toContain("Start fluids");
  });

  it("always adds the limitation about the export", () => {
    expect(run(reply()).picture.limitations.at(-1)).toMatch(/Other records may exist/);
  });

  it("rejects a reply with no picture", () => {
    expect(() => run({ questions: [] })).toThrow(/unexpected format/);
    expect(() => run(null)).toThrow();
    expect(() => run("text")).toThrow();
  });

  it("accepts a reply with no questions at all", () => {
    const r = run({ picture: reply().picture });
    expect(r.newQuestions).toEqual([]);
  });
});

describe("a name that reaches the store another way", () => {
  it("is still removed from the prompt (second layer, after recordAnswer)", () => {
    const w = applyRound(fresh(), run(reply(), fresh()));
    // An answer written straight into storage, bypassing recordAnswer's scrubbing.
    const sneaky = { ...w, answers: [{ id: "A1", questionId: "Q1", status: "answered", value: "Adaeze 08031234567 is worse", by: "nurse", at: NOW.toISOString(), round: 1 }], questions: w.questions.map((x) => (x.id === "Q1" ? { ...x, status: "answered" } : x)) };
    const p = buildWorkupPrompt(snapOf(sneaky), { workup: sneaky, lenses: lenses(), capabilities: [], nextRound: 2, questionsAllowed: true });
    expect(p).not.toMatch(/Adaeze/i);
    expect(p).not.toMatch(/0803/);
  });
});

describe("the prompt", () => {
  const prompt = () => {
    const w = fresh();
    return buildWorkupPrompt(snapOf(w), { workup: w, lenses: lenses(), capabilities: [], nextRound: 1, questionsAllowed: true });
  };
  it("never contains the patient's name", () => {
    expect(prompt()).not.toMatch(/Adaeze/i);
  });
  it("forbids commands, invented doses and repeated questions", () => {
    const p = prompt();
    expect(p).toMatch(/ends with "\?"/);
    expect(p).toMatch(/Do not write doses/);
    expect(p).toMatch(/Never begin a suggestion with a verb/);
    expect(p).toMatch(/Do not repeat an unanswered question/);
  });
  it("says the hospital's list decides availability", () => {
    expect(prompt()).toMatch(/hospital's list decides/);
  });
});

describe("a whole workup with a scripted AI", () => {
  const input = (workup, capabilities = []) => ({ ...RECORD, workup, capabilities, now: NOW });

  it("runs three rounds, remembers answers, and stops", async () => {
    const prompts = [];
    const script = [
      reply({ questions: [q(), q({ audience: "doctor", kind: "history", text: "Is there a past history of high blood pressure?", basis: ["F2"] })] }),
      reply({ questions: [q({ text: "Has the leg swelling changed since admission?", basis: ["R2"] })] }),
      reply({ questions: [q({ text: "Anything else to report on the chest?" })] }),
    ];
    const ask = async (p) => { prompts.push(p); return script[prompts.length - 1]; };

    let { result, workup } = await runWorkupRound(input(fresh()), { ask });
    expect(result.round).toBe(1);
    expect(workup.questions).toHaveLength(2);
    expect(canRunRound(workup).reason).toBe("no_new_answers");
    await expect(runWorkupRound(input(workup), { ask })).rejects.toMatchObject({ code: "no_new_answers" });

    workup = recordAnswer(workup, { questionId: "Q1", value: "No, needs 3 pillows", by: "nurse", patientName: "Adaeze Demo" });
    ({ result, workup } = await runWorkupRound(input(workup), { ask }));
    expect(result.round).toBe(2);
    expect(prompts[1]).toContain("needs 3 pillows");
    expect(prompts[1]).toMatch(/QUESTIONS STILL WAITING[\s\S]*Q2/);
    expect(prompts[1]).not.toMatch(/Adaeze/i);

    workup = recordAnswer(workup, { questionId: "Q3", status: "not_available" });
    ({ result, workup } = await runWorkupRound(input(workup), { ask }));
    expect(result.round).toBe(3);
    expect(result.questionsAllowed).toBe(false);
    expect(prompts[2]).toMatch(/the LAST round/);
    expect(workup.picture.reviewStatus).toBe(REVIEW_AWAITING);

    workup = recordAnswer(workup, { questionId: "Q2", value: "Yes, 20 years" });
    await expect(runWorkupRound(input(workup), { ask })).rejects.toMatchObject({ code: "max_rounds" });
    expect(prompts).toHaveLength(3);
  });

  it("does not call the AI when the workup is not allowed to run", async () => {
    let calls = 0;
    const ask = async () => { calls += 1; return reply(); };
    await expect(runWorkupRound(input({ ...fresh(), round: MAX_ROUNDS }), { ask })).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("refuses an empty record without calling the AI", async () => {
    let calls = 0;
    const ask = async () => { calls += 1; return reply(); };
    await expect(runWorkupRound({ extracted: {}, workup: fresh() }, { ask })).rejects.toThrow(/empty/);
    expect(calls).toBe(0);
  });

  it("passes the hospital's test list to the AI and applies it to the result", async () => {
    let seen = "";
    const ask = async (p) => { seen = p; return reply(); };
    const caps = [{ name: "ECG", status: "available" }, { name: "CT scan", status: "not_available" }];
    const { result } = await runWorkupRound(input(fresh(), caps), { ask });
    expect(seen).toMatch(/ECG: available here/);
    expect(seen).toMatch(/CT scan: NOT available here/);
    expect(result.picture.tests[0].availability).toBe("available");
  });

  it("only asks the audiences it knows", () => {
    expect(AUDIENCES).toEqual(["nurse", "doctor"]);
  });
});
