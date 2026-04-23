/**
 * claudeApi.ts
 *
 * Client-side API utility for all AI generation in Handova.
 *
 * Two entry points:
 *   generateNursesNote  — structured mode (existing form-based flow)
 *   generateFromRaw     — quick mode (raw text dump → full shift report)
 *
 * Both call /api/generate. Neither exposes the API key — it lives
 * exclusively in Vercel environment variables.
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { buildStructuredPrompt, buildRawInputPrompt } from "./reportFormatter";
import type { Patient, ShiftHeader } from "../types";
import type { AppSettings } from "./settings";
import { getRegionConfig } from "./regionConfig";

// ─── SHARED FETCH ─────────────────────────────────────────────────────────────

async function callGenerateAPI(prompt: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch {
    throw new Error("Network error — please check your internet connection and try again.");
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json() as Record<string, unknown>;
  } catch {
    throw new Error("Unexpected response from server. Please try again.");
  }

  if (!response.ok) {
    const msg = typeof data?.error === "string" ? data.error : `Server error (${response.status})`;
    throw new Error(msg);
  }

  const choices = data.choices as Array<{ message: { content: string } }> | undefined;
  let text = choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty response from AI. Your notes were not lost — please try again.");

  // Strip out the Chain-of-Thought thinking block if present
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");

  return text.trim();
}

// ─── STRUCTURED MODE ──────────────────────────────────────────────────────────

/**
 * generateNursesNote — existing structured-form flow.
 * Requires currentDiagnosis and nursesNoteRaw to be populated.
 */
export async function generateNursesNote(
  patient: Patient,
  header: ShiftHeader,
  format: "standard" | "sbar" | "isbar" | "soap" = "standard",
  settings?: AppSettings
): Promise<string> {
  if (!patient.nursesNoteRaw?.trim()) {
    throw new Error("Please enter shift events before generating.");
  }
  if (!patient.currentDiagnosis?.trim()) {
    throw new Error("Please enter the current diagnosis.");
  }
  if (patient.nursesNoteRaw.length > 6000) {
    throw new Error("Shift notes are too long. Please shorten and try again.");
  }

  const region = settings?.region || "ng";
  const prompt = buildStructuredPrompt(patient, header, format, region);

  return callGenerateAPI(prompt);
}

// ─── QUICK MODE ───────────────────────────────────────────────────────────────

export interface QuickModeOptions {
  rawText: string;
  format: "standard" | "sbar" | "isbar" | "soap";
  settings?: AppSettings;
}

export interface QuickModeResult {
  report: string;         // the full formatted shift report, ready to copy
  patientsFound: number;  // how many patients the AI detected
}

/**
 * generateFromRaw — Quick Mode entry point.
 *
 * The nurse dumps everything in one block of text — messy, unstructured,
 * stream-of-consciousness. This function sends it to the AI with a prompt
 * that extracts structure, generates nurses' notes per patient, and assembles
 * a complete HMS-ready report.
 *
 * No required fields. No gates. Works with whatever the nurse provides.
 */
export async function generateFromRaw(options: QuickModeOptions): Promise<QuickModeResult> {
  const { rawText, format, settings } = options;

  if (!rawText?.trim()) {
    throw new Error("Please enter some shift notes before generating.");
  }
  if (rawText.trim().length < 20) {
    throw new Error("Notes are too short. Add more detail about the shift.");
  }
  if (rawText.length > 10000) {
    throw new Error("Notes are too long. Please split across multiple patients or shorten.");
  }

  const prompt = buildRawInputPrompt(rawText, format, {
    ...settings,
    region: settings?.region || "ng",
  });
  const report = await callGenerateAPI(prompt);

  // Count patient blocks in the output to give feedback
  const patientsFound = (report.match(/INPATIENT\s+\d+/gi) || []).length || 1;

  return { report, patientsFound };
}

// ─── "WHAT CHANGED?" MODE ─────────────────────────────────────────────────────

export interface WhatChangedOptions {
  previousReport: string;  // the full text of last shift's report
  changesRaw: string;      // what the nurse said changed this shift
  settings?: AppSettings;
}

/**
 * generateFromChanges — "Continue last shift" mode.
 *
 * Loads the previous shift report and the nurse's "what changed" notes,
 * then generates an updated report reflecting the changes while preserving
 * unchanged patient information.
 */
export async function generateFromChanges(options: WhatChangedOptions): Promise<string> {
  const { previousReport, changesRaw, settings } = options;

  if (!changesRaw?.trim()) {
    throw new Error("Please describe what changed this shift before generating.");
  }

  const authorLine = settings?.nurseName
    ? `${settings.nurseName}${settings.nurseCredentials ? ", " + settings.nurseCredentials : ""}`
    : "Gbenga Adejuyigbe, RN, BNSc";

  const facilityLine = settings?.facilityName || "Nigeria Police Medical Services, Akure";

  const regionCfg = getRegionConfig(settings?.region || "ng");

  const prompt = `You are a hospital nursing documentation system for ${regionCfg.label} updating a shift handover report following ${regionCfg.compliance} documentation standards.

The nurse worked a previous shift and is now updating the report for the current shift. You have the previous shift report and the nurse's notes about what changed.

PREVIOUS SHIFT REPORT:
${previousReport}

WHAT CHANGED THIS SHIFT (nurse's raw notes):
${changesRaw}

---

INSTRUCTIONS:
1. Start with the same ward, shift type (update to current shift), and today's date
2. Update the SHIFT PATIENT FLOW numbers if the nurse mentioned them
3. For each patient that is MENTIONED in the "what changed" notes:
   - Update their NURSES' NOTE to reflect what happened this shift
   - Update vitals if new ones were mentioned
   - Update condition at report if it changed
4. For patients NOT mentioned: keep their information exactly as it was in the previous report, but update the NURSES' NOTE opening to reflect they were "taken over" at the start of this shift
5. Add any new patients mentioned in the changes
6. Remove any patients the nurse mentions were discharged (but note the discharge)
7. ${regionCfg.clinicalLanguagePrompt}
8. End each patient's note with their condition at time of report

OUTPUT: A complete, formatted shift report exactly in the same format as the previous report — ready to copy and paste into ${regionCfg.terminology.emrName}.

Author line at the end: ${authorLine} · ${facilityLine} · Generated via Handova v12.0`;

  return callGenerateAPI(prompt);
}
