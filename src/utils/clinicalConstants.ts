/**
 * Clinical constants for Handova.
 *
 * These values reflect real Nigerian hospital ward names, shift structures,
 * and clinical terminology as used at NPMS Akure and similar facilities.
 * Changes here should be clinically justified — not just cosmetic.
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import type { ArrivalType, ConditionAtReport, ShiftType } from "../types";

// ─── WARDS ───────────────────────────────────────────────────────────────────

/**
 * Nigerian hospital ward names as commonly used in federal and state facilities.
 * "Other" is always last — it triggers a free-text input in the UI.
 */
export const WARDS: string[] = [
  "Accident and Emergency",
  "Adult and Paediatrics Ward",
  "Female Medical Ward",
  "Male Medical Ward",
  "Obstetrics and Gynaecology Ward",
  "Paediatrics Ward",
  "Surgical Ward",
  "Recovery Ward",
  "Intensive Care Unit",
  "Outpatient Department",
  "Other",
];

// ─── SHIFTS ──────────────────────────────────────────────────────────────────

/**
 * Standard shift types.
 * Morning: typically 07:00 – 14:00
 * Evening: typically 14:00 – 21:00
 * Night:   typically 21:00 – 07:00
 */
export const SHIFTS: ShiftType[] = ["Morning", "Afternoon", "Night/Evening"];

// ─── PATIENT ─────────────────────────────────────────────────────────────────

export const GENDERS: string[] = ["Male", "Female"];

/**
 * How a patient arrived or was encountered at the start of the shift.
 * This is clinically significant — it determines the opening of the nurse's note.
 *
 * "Taken over at shift start" → patient was already in the ward
 * "Walked in" → patient presented themselves at the ward entrance
 * "Rushed in" → emergency presentation, usually via ambulance or family
 * "From consulting room" → referred from OPD/consulting after review
 * "Transfer in" → transferred from another ward or facility (requires source)
 * "Other" → any other arrival context (requires free-text specification)
 */
export const ARRIVAL_TYPES: ArrivalType[] = [
  "Taken over at shift start",
  "Walked in",
  "Rushed in",
  "From consulting room",
  "Transfer in",
  "Other",
];

/**
 * Patient condition at the time of shift report.
 * This appears in the final closing line of the nurse's note and in the report.
 * "Fair" is the Nigerian clinical standard for a patient who is not critically ill
 * but not yet fully stable — distinct from "Stable."
 */
export const CONDITION_OPTIONS: ConditionAtReport[] = [
  "Stable",
  "Fair",
  "Critical",
  "Improving",
  "Deteriorating",
];

// ─── DEFAULTS ────────────────────────────────────────────────────────────────

export const EMPTY_SHIFT_HEADER = {
  ward: "",
  shift: "" as ShiftType | "",
  date: "",
  takenOver: "",
  admissions: "",
  transfersIn: "",
  transfersOut: "",
  discharges: "",
  dama: "",
  deaths: "",
  referralsOut: "",
};

export const EMPTY_VITALS = {
  bp: "",
  pulse: "",
  respRate: "",
  temp: "",
  spo2: "",
  rbs: "",
};

export const DEFAULT_CONDITION: ConditionAtReport = "Stable";
