/**
 * Fake patients for the clinician dashboard demo. Every person, value and result here is
 * invented. Nothing is saved or sent anywhere. The shape matches what the Specialist
 * pipeline (api/_specialist.js) returns, so the real output can replace this later.
 */

// Must match SPECIALIST_DISCLAIMER in api/_specialist.js (a test checks this).
export const DEMO_DISCLAIMER =
  "AI-generated suggestion for the responsible clinician's consideration. " +
  "Not a diagnosis, not an order, and not a substitute for clinical judgment. " +
  "The decision rests with you.";

export type GapState =
  | "not_documented"
  | "ordered_not_completed"
  | "completed_pending"
  | "completed_available"
  | "possibly_elsewhere"
  | "not_ordered_consider";

export type NextStep = "locate_existing" | "clarify_record" | "complete_ordered" | "consider_new";
export type Urgency = "urgent" | "soon" | "routine";

export interface DemoItem { text: string; basis: string[]; grounding?: string; unverifiedNumbers?: string[] }

export interface DemoGap {
  missing: string;
  state: GapState;
  why: string;
  limitation: string;
  nextStep: NextStep;
  urgency: Urgency;
  needsClinicianDecision: boolean;
  basis: string[];
  unverifiedNumbers?: string[];
  downgradedFrom?: string;
}

export interface DemoPerspective {
  id: string;
  specialtyLabel: string;
  headline: string;
  interpretations: DemoItem[];
  differentials: DemoItem[];
  risks: DemoItem[];
  evidenceGaps: DemoGap[];
  monitoring: DemoItem[];
  management: DemoItem[];
  escalation: DemoItem[];
  limitations: string[];
  disclaimer: string;
  reviewStatus: "awaiting_medical_review";
}

/** The part of a fact the cards need. The real pipeline returns more. */
export type FactRef = { id: string; label: string; value: string };

export interface DemoFact {
  id: string;
  label: string;
  value: string;
  source: string;
  time: string;
  verification: "unverified" | "nurse_verified";
}

export interface DemoPatient {
  id: string;
  label: string;
  age: number;
  sex: string;
  diagnosis: string;
  changes: string[];
  facts: DemoFact[];
  perspectives: DemoPerspective[];
}

const LIMIT = "Based only on the information in this export. Other records may exist.";
const none: DemoItem[] = [];

export const DEMO_PATIENTS: DemoPatient[] = [
  {
    id: "A",
    label: "Demo Patient A",
    age: 47,
    sex: "Female",
    diagnosis: "Severe malaria",
    changes: [
      "Pulse 112 at the 08:00 check",
      "Second artesunate dose recorded as given",
      "Urea and creatinine ordered",
    ],
    facts: [
      { id: "F1", label: "Age", value: "47", source: "HMS export", time: "Day 1", verification: "nurse_verified" },
      { id: "F2", label: "Sex", value: "Female", source: "HMS export", time: "Day 1", verification: "nurse_verified" },
      { id: "F3", label: "Current diagnosis", value: "Severe malaria", source: "HMS export", time: "Day 1 06:30", verification: "nurse_verified" },
      { id: "F4", label: "Medications recorded", value: "IV artesunate 120 mg at 0, 12 and 24 hours; IV paracetamol", source: "HMS export", time: "Day 1 07:00", verification: "unverified" },
      { id: "F5", label: "BP", value: "100/60", source: "Nurse entry", time: "Day 1 08:00", verification: "nurse_verified" },
      { id: "F6", label: "Pulse", value: "112", source: "Nurse entry", time: "Day 1 08:00", verification: "nurse_verified" },
      { id: "F7", label: "Temperature", value: "38.6 C", source: "Nurse entry", time: "Day 1 08:00", verification: "nurse_verified" },
      { id: "F8", label: "SpO2", value: "96%", source: "Nurse entry", time: "Day 1 08:00", verification: "nurse_verified" },
      { id: "F9", label: "Random blood sugar", value: "4.1 mmol/L", source: "Nurse entry", time: "Day 1 08:00", verification: "nurse_verified" },
      { id: "F10", label: "PCV", value: "22% on admission", source: "HMS export", time: "Day 1 06:45", verification: "unverified" },
      { id: "F11", label: "Malaria parasite count", value: "Sample sent, result pending", source: "HMS export", time: "Day 1 07:15", verification: "unverified" },
      { id: "F12", label: "Urea and creatinine", value: "Ordered, not yet done", source: "HMS export", time: "Day 1 07:30", verification: "unverified" },
    ],
    perspectives: [
      {
        id: "A-P1",
        specialtyLabel: "Infectious disease",
        headline: "Severe malaria early in treatment: response and complications to keep in view",
        interpretations: [
          { text: "Temperature 38.6 C and pulse 112 are consistent with active severe infection. Early in treatment this alone does not show a poor response.", basis: ["F6", "F7"] },
        ],
        differentials: [
          { text: "A co-existing bacterial infection can accompany severe malaria and may be worth keeping in mind if fever persists.", basis: [] },
        ],
        risks: [
          { text: "Severe malaria can involve kidney injury, low blood sugar and worsening anaemia.", basis: [] },
        ],
        evidenceGaps: [
          { missing: "Urea and creatinine", state: "ordered_not_completed", why: "Kidney involvement is a recognised complication of severe malaria.", limitation: "Kidney function is currently unknown.", nextStep: "complete_ordered", urgency: "soon", needsClinicianDecision: false, basis: ["F12"] },
          { missing: "Urine output record", state: "not_documented", why: "Reduced urine output can be an early sign of kidney involvement.", limitation: "Fluid balance and kidney function cannot be judged from output.", nextStep: "clarify_record", urgency: "soon", needsClinicianDecision: true, basis: [] },
          { missing: "Parasite count result", state: "completed_pending", why: "Shows the burden of infection and how quickly it is falling.", limitation: "Treatment response cannot be judged without it.", nextStep: "locate_existing", urgency: "routine", needsClinicianDecision: false, basis: ["F11"] },
        ],
        monitoring: [
          { text: "Blood glucose checks may be worth considering during treatment. The last value in the record is 4.1 mmol/L.", basis: ["F9"] },
        ],
        management: none,
        escalation: [
          { text: "If fever and pulse do not settle as treatment continues, the doctor may want to be told.", basis: ["F6", "F7"] },
        ],
        limitations: ["Single time point; the trend is unknown.", LIMIT],
        disclaimer: DEMO_DISCLAIMER,
        reviewStatus: "awaiting_medical_review",
      },
      {
        id: "A-P2",
        specialtyLabel: "Haematology",
        headline: "Anaemia: PCV 22% on admission with no repeat documented",
        interpretations: [
          { text: "A PCV of 22% on admission could reflect red cell destruction from malaria.", basis: ["F10"] },
        ],
        differentials: none,
        risks: [
          { text: "Anaemia can worsen during treatment of severe malaria.", basis: [] },
        ],
        evidenceGaps: [
          { missing: "Repeat PCV or haemoglobin", state: "not_documented", why: "Shows whether the anaemia is stable or worsening.", limitation: "The direction of change is unknown.", nextStep: "clarify_record", urgency: "soon", needsClinicianDecision: true, basis: ["F10"] },
        ],
        monitoring: none,
        management: [
          { text: "Whether transfusion is indicated is a clinical decision for the doctor. A documented plan would help the nursing team.", basis: ["F10"] },
        ],
        escalation: none,
        limitations: [LIMIT],
        disclaimer: DEMO_DISCLAIMER,
        reviewStatus: "awaiting_medical_review",
      },
    ],
  },
  {
    id: "B",
    label: "Demo Patient B",
    age: 58,
    sex: "Male",
    diagnosis: "Decompensated heart failure",
    changes: [
      "RR 26 and SpO2 93% at the latest check",
      "Day 1 creatinine and potassium resulted",
    ],
    facts: [
      { id: "F1", label: "Age", value: "58", source: "HMS export", time: "Day 2", verification: "nurse_verified" },
      { id: "F2", label: "Sex", value: "Male", source: "HMS export", time: "Day 2", verification: "nurse_verified" },
      { id: "F3", label: "Current diagnosis", value: "Decompensated heart failure", source: "HMS export", time: "Day 1", verification: "nurse_verified" },
      { id: "F4", label: "Medications recorded", value: "IV furosemide 40 mg twice daily; spironolactone 25 mg daily", source: "HMS export", time: "Day 2 07:00", verification: "unverified" },
      { id: "F5", label: "BP", value: "150/90", source: "Nurse entry", time: "Day 2 08:00", verification: "nurse_verified" },
      { id: "F6", label: "Pulse", value: "96", source: "Nurse entry", time: "Day 2 08:00", verification: "nurse_verified" },
      { id: "F7", label: "Respiratory rate", value: "26", source: "Nurse entry", time: "Day 2 08:00", verification: "nurse_verified" },
      { id: "F8", label: "SpO2", value: "93%", source: "Nurse entry", time: "Day 2 08:00", verification: "nurse_verified" },
      { id: "F9", label: "Creatinine", value: "168 umol/L (day 1)", source: "HMS export", time: "Day 1 14:00", verification: "unverified" },
      { id: "F10", label: "Potassium", value: "5.4 mmol/L (day 1)", source: "HMS export", time: "Day 1 14:00", verification: "unverified" },
      { id: "F11", label: "Intake and output chart", value: "Requested; no totals documented", source: "HMS export", time: "Day 1", verification: "unverified" },
      { id: "F12", label: "Echocardiogram", value: "No report in this export", source: "HMS export", time: "Day 2", verification: "unverified" },
    ],
    perspectives: [
      {
        id: "B-P1",
        specialtyLabel: "Cardiology",
        headline: "Congestion and diuretic response: urine output is the missing piece",
        interpretations: [
          { text: "Respiratory rate 26 and SpO2 93% could suggest ongoing pulmonary congestion.", basis: ["F7", "F8"] },
        ],
        differentials: [
          { text: "The cause of the heart failure is not stated. Ischaemic, hypertensive and valvular causes are among the possibilities a doctor may want to consider.", basis: ["F3"] },
        ],
        risks: [
          { text: "A diuretic together with spironolactone can affect potassium and kidney function.", basis: ["F4"] },
        ],
        evidenceGaps: [
          { missing: "Urine output totals", state: "not_documented", why: "Shows whether the diuretic is working.", limitation: "Response to treatment cannot be judged.", nextStep: "clarify_record", urgency: "soon", needsClinicianDecision: true, basis: ["F11"] },
          { missing: "Echocardiogram report", state: "possibly_elsewhere", why: "Shows heart function and valve disease.", limitation: "Cause and severity cannot be judged from this record alone.", nextStep: "locate_existing", urgency: "routine", needsClinicianDecision: false, basis: ["F12"] },
        ],
        monitoring: [
          { text: "Daily weights are one way to track fluid balance, if available on the ward.", basis: [] },
        ],
        management: none,
        escalation: none,
        limitations: [LIMIT],
        disclaimer: DEMO_DISCLAIMER,
        reviewStatus: "awaiting_medical_review",
      },
      {
        id: "B-P2",
        specialtyLabel: "Nephrology",
        headline: "Kidney function and potassium on a diuretic plus spironolactone",
        interpretations: [
          { text: "Creatinine 168 umol/L and potassium 5.4 mmol/L on day 1 may reflect reduced kidney function, which could matter for spironolactone.", basis: ["F9", "F10", "F4"] },
        ],
        differentials: none,
        risks: none,
        evidenceGaps: [
          { missing: "Trend in creatinine and potassium", state: "completed_available", why: "A single value cannot show whether kidney function is improving or worsening.", limitation: "Only day 1 results are in the record.", nextStep: "consider_new", urgency: "soon", needsClinicianDecision: true, basis: ["F9", "F10"] },
          { missing: "Repeat creatinine and potassium", state: "not_ordered_consider", why: "Potassium may rise on spironolactone when kidney function is reduced.", limitation: "No follow-up result is planned in the record.", nextStep: "consider_new", urgency: "soon", needsClinicianDecision: true, basis: ["F4"] },
        ],
        monitoring: none,
        management: none,
        escalation: [
          { text: "A rising potassium or falling urine output is something the doctor may want to hear about promptly.", basis: ["F10"] },
        ],
        limitations: [LIMIT],
        disclaimer: DEMO_DISCLAIMER,
        reviewStatus: "awaiting_medical_review",
      },
    ],
  },
  {
    id: "C",
    label: "Demo Patient C",
    age: 52,
    sex: "Male",
    diagnosis: "? Upper gastrointestinal bleeding",
    changes: [
      "Pulse 118 and BP 98/62 at the latest check",
      "Second episode of melaena noted",
    ],
    facts: [
      { id: "F1", label: "Age", value: "52", source: "HMS export", time: "Day 1", verification: "nurse_verified" },
      { id: "F2", label: "Sex", value: "Male", source: "HMS export", time: "Day 1", verification: "nurse_verified" },
      { id: "F3", label: "Current diagnosis", value: "? Upper gastrointestinal bleeding", source: "HMS export", time: "Day 1", verification: "nurse_verified" },
      { id: "F4", label: "Medications recorded", value: "IV omeprazole 40 mg twice daily", source: "HMS export", time: "Day 1 09:00", verification: "unverified" },
      { id: "F5", label: "BP", value: "98/62", source: "Nurse entry", time: "Day 1 11:00", verification: "nurse_verified" },
      { id: "F6", label: "Pulse", value: "118", source: "Nurse entry", time: "Day 1 11:00", verification: "nurse_verified" },
      { id: "F7", label: "SpO2", value: "97%", source: "Nurse entry", time: "Day 1 11:00", verification: "nurse_verified" },
      { id: "F8", label: "Nurse note", value: "Melaena for 2 days; second episode this morning", source: "Nurse entry", time: "Day 1 10:30", verification: "nurse_verified" },
      { id: "F9", label: "Haemoglobin", value: "Not in this export", source: "HMS export", time: "Day 1", verification: "unverified" },
    ],
    perspectives: [
      {
        id: "C-P1",
        specialtyLabel: "Gastroenterology and surgery",
        headline: "Possible ongoing bleeding: the haemodynamics and the missing haemoglobin",
        interpretations: [
          { text: "Pulse 118 with BP 98/62 could suggest volume loss, particularly with melaena.", basis: ["F5", "F6", "F8"] },
        ],
        differentials: [
          { text: "Peptic ulcer disease and varices are among the possible sources a doctor may want to consider.", basis: ["F3"] },
        ],
        risks: [
          { text: "Ongoing gastrointestinal bleeding can deteriorate quickly.", basis: [] },
        ],
        evidenceGaps: [
          { missing: "Haemoglobin or PCV", state: "not_documented", why: "Shows the degree of blood loss.", limitation: "Severity cannot be judged.", nextStep: "clarify_record", urgency: "urgent", needsClinicianDecision: true, basis: ["F9"] },
          { missing: "Endoscopy", state: "not_ordered_consider", why: "Can identify the bleeding source.", limitation: "The source is unknown.", nextStep: "consider_new", urgency: "soon", needsClinicianDecision: true, basis: ["F3"] },
        ],
        monitoring: [
          { text: "More frequent pulse and BP checks could be worth considering while the picture is unclear.", basis: ["F5", "F6"] },
        ],
        management: none,
        escalation: [
          { text: "Persistent tachycardia with a falling BP is something the doctor on call may want to know about.", basis: ["F5", "F6"] },
        ],
        limitations: [LIMIT],
        disclaimer: DEMO_DISCLAIMER,
        reviewStatus: "awaiting_medical_review",
      },
    ],
  },
];
