/**
 * Core domain types for Handova.
 * These types reflect the real structure of Nigerian hospital nursing documentation.
 * Every field maps directly to something that appears in a shift report or nurse's note.
 */

// ─── SHIFT QUESTIONS ─────────────────────────────────────────────────────────

/**
 * A single AI-generated shift assessment question with the nurse's answer.
 * Questions are generated automatically after EMR PDF upload, specific to
 * the patient's clinical picture. Answers feed directly into AI note generation.
 */
export interface ShiftQuestion {
  id: number;
  question: string;     // AI-generated question specific to this patient
  answer: string;       // Nurse's answer — typed or voice-transcribed
  isRecording: boolean; // UI state — mic is active for this question
}

// ─── SHIFT ───────────────────────────────────────────────────────────────────

export type ShiftType = "Morning" | "Afternoon" | "Night/Evening";

/**
 * Patient flow statistics for a shift.
 * The arithmetic invariant:
 *   patientsAtHandover = takenOver + admissions + transfersIn
 *                        - transfersOut - discharges - dama - deaths - referralsOut
 */
export interface ShiftHeader {
  ward: string;
  shift: ShiftType | "";
  date: string; // ISO date string YYYY-MM-DD from input[type=date]
  takenOver: string;
  admissions: string;
  transfersIn: string;
  transfersOut: string;
  discharges: string;
  dama: string;
  deaths: string;
  referralsOut: string;
}

// ─── PATIENT ─────────────────────────────────────────────────────────────────

/**
 * How a patient arrived or was taken over during the shift.
 * This is the single most important field for the AI prompt —
 * it determines the opening sentence of the nurse's note.
 * A patient "taken over" opens differently from one "rushed in."
 */
export type ArrivalType =
  | "Taken over at shift start"
  | "Walked in"
  | "Rushed in"
  | "From consulting room"
  | "Transfer in"
  | "Other"
  | "";

export type ConditionAtReport =
  | "Stable"
  | "Fair"
  | "Critical"
  | "Improving"
  | "Deteriorating";

export type Gender = "Male" | "Female" | "";

/**
 * Vital signs recorded at the end of the shift.
 * All values are strings to allow flexible input (e.g. "120/80" for BP).
 */
export interface VitalSigns {
  bp: string;       // e.g. "120/80"
  pulse: string;    // bpm
  respRate: string; // cpm
  temp: string;     // °C
  spo2: string;     // %
  rbs: string;      // mmol/L or mg/dL
}

/**
 * A single inpatient on the ward during the shift.
 * This maps directly to one "INPATIENT N" block in the final report.
 */
export interface Patient {
  id: number;
  name: string;
  age: string;
  gender: Gender;
  ward: string;
  bedNumber: string;
  admissionDate: string;
  dischargeDate: string;
  initialDiagnosis: string;
  currentDiagnosis: string;
  investigation: string;

  // Arrival context — drives how the AI opens the nurse's note
  arrivalType: ArrivalType;
  arrivalFrom: string;   // populated when arrivalType === "Transfer in"
  arrivalOther: string;  // populated when arrivalType === "Other"

  // Doctor's ward round plan — if provided, woven into the narrative
  doctorsPlan: string;

  // Raw nurse input — the source of truth for AI generation
  nursesNoteRaw: string;

  // Filtered EMR clinical text from PDF upload — passed into AI prompt for rich note generation
  emrClinicalText?: string;

  // AI-generated shift assessment questions — generated automatically after EMR upload.
  // Each question is specific to this patient's clinical picture.
  // Nurse answers by voice or text. Answers are injected into the generation prompt
  // as primary shift-specific evidence alongside emrClinicalText and nursesNoteRaw.
  shiftQuestions: ShiftQuestion[];

  // True while /api/generate-questions is in flight
  questionsLoading: boolean;

  // AI-generated output — editable by nurse before copying
  nursesNoteGenerated: string;

  fluid: string;
  medsAdministered: string;
  vitals: VitalSigns;
  conditionAtReport: ConditionAtReport;

  // UI state — not part of the report, just for rendering
  isGenerating: boolean;
  noteReady: boolean;
}

// ─── REPORT ──────────────────────────────────────────────────────────────────

/**
 * The assembled shift report ready for copy-paste into the HMS.
 * This is the final output of the entire app.
 */
export interface ShiftReport {
  header: ShiftHeader;
  patients: Patient[];
  generatedAt: Date;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export interface GenerateRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface GenerateResponse {
  choices: Array<{
    message: { content: string; role: string };
    finish_reason: string;
  }>;
}

export interface ApiError {
  error: string;
}
