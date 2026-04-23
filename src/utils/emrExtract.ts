/**
 * emrExtract.ts — Handova v10.2
 *
 * Client-side EMR extraction utility.
 *
 * Sends the PDF as base64 to /api/extract-emr.
 * The server handles everything:
 *   Stage 1 — pdf-parse extracts raw text
 *   Stage 2 — deterministic filter finds recent clinical data
 *   Stage 3 — Groq extracts structured JSON
 *
 * This file only handles:
 * - File validation
 * - Base64 conversion
 * - Fetch to /api/extract-emr
 * - Parsing and mapping the JSON response to PatientForm fields
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import type { Patient } from "../types";

// Robust JSON parser — handles thinking blocks, markdown fences, and preamble text
function parseJsonSafely(raw: string): Record<string, unknown> {
  let clean = raw
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/^```json\n?|^```\n?|```$/gm, "")
    .trim();
  try {
    return JSON.parse(clean) as Record<string, unknown>;
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch { /* fall through */ }
    }
    throw new Error("Could not parse extracted data. Please try again.");
  }
}

export interface EmrExtractResult {
  extracted: Partial<Patient> & { doctorsPlan?: string };
  unreviewedResults: string[];
  flags: string[];
  summary: string;
  emrClinicalText: string;  // The filtered clinical text — used in AI note generation
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function extractFromEmrPdf(file: File): Promise<EmrExtractResult> {
  if (!file) throw new Error("No file provided");

  if (file.type !== "application/pdf") {
    throw new Error("Please upload a PDF file. Image uploads are not supported for EMR extraction.");
  }

  if (file.size > 20 * 1024 * 1024) {
    throw new Error("File too large. Please upload a PDF under 20MB.");
  }

  const base64Data = await fileToBase64(file);

  const response = await fetch("/api/extract-emr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document: {
        data: base64Data,
        mediaType: "application/pdf",
      },
    }),
  });

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
  const rawText = choices?.[0]?.message?.content?.trim();
  if (!rawText) throw new Error("Empty response from AI. Please try again.");

  const emrClinicalText = (data.filteredText as string) || "";
  const parsed = parseJsonSafely(rawText);

  // Build vitals safely
  const rawVitals = (parsed.vitals as Record<string, string>) || {};
  const vitals = {
    bp: rawVitals.bp || "",
    pulse: rawVitals.pulse || "",
    respRate: rawVitals.respRate || "",
    temp: rawVitals.temp || "",
    spo2: rawVitals.spo2 || "",
    rbs: rawVitals.rbs || "",
  };

  // Normalise admissionDate to YYYY-MM-DD for input[type=date]
  let admissionDate = (parsed.admissionDate as string) || "";
  if (admissionDate && !admissionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const d = new Date(admissionDate);
    admissionDate = !isNaN(d.getTime()) ? d.toISOString().split("T")[0] : "";
  }

  const cleanDx = (raw: string): string =>
    raw.replace(new RegExp("^(dx[-:\\s]*|ass[-:\\s]*|assessment[-:\\s]*)", "i"), "").trim();

  return {
    emrClinicalText,
    extracted: {
      name: (parsed.name as string) || "",
      age: (parsed.age as string) || "",
      gender: (parsed.gender as string) === "Male"
        ? "Male"
        : (parsed.gender as string) === "Female"
        ? "Female"
        : "" as Patient["gender"],
      ward: (parsed.ward as string) || "",
      bedNumber: (parsed.bedNumber as string) || "",
      admissionDate,
      initialDiagnosis: cleanDx((parsed.initialDiagnosis as string) || ""),
      currentDiagnosis: cleanDx((parsed.currentDiagnosis as string) || ""),
      doctorsPlan: (parsed.doctorsPlan as string) || "",
      medsAdministered: (parsed.medsAdministered as string) || "",
      vitals,
    },
    unreviewedResults: (parsed.unreviewedResults as string[]) || [],
    flags: (parsed.flags as string[]) || [],
    summary: (parsed.summary as string) || "",
  };
}

export async function extractFromImages(files: File[]): Promise<EmrExtractResult> {
  if (!files || files.length === 0) throw new Error("No files provided");

  const documents = await Promise.all(
    files.map(async (file) => {
      if (!file.type.startsWith("image/")) {
        throw new Error("Only image files are allowed in this mode.");
      }
      if (file.size > 20 * 1024 * 1024) {
        throw new Error("A file is too large. Images must be under 20MB.");
      }
      return {
        data: await fileToBase64(file),
        mediaType: file.type || "image/jpeg",
      };
    })
  );

  const totalSize = documents.reduce((acc, doc) => acc + doc.data.length, 0);
  if (totalSize > 28 * 1024 * 1024) {
    throw new Error("Total upload size too large. Please upload fewer images.");
  }

  const response = await fetch("/api/extract-emr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documents }),
  });

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
  const rawText = choices?.[0]?.message?.content?.trim();
  if (!rawText) throw new Error("Empty response from AI. Please try again.");

  const emrClinicalText = (data.filteredText as string) || "";
  const parsed = parseJsonSafely(rawText);

  const rawVitals = (parsed.vitals as Record<string, string>) || {};
  const vitals = {
    bp: rawVitals.bp || "",
    pulse: rawVitals.pulse || "",
    respRate: rawVitals.respRate || "",
    temp: rawVitals.temp || "",
    spo2: rawVitals.spo2 || "",
    rbs: rawVitals.rbs || "",
  };

  let admissionDate = (parsed.admissionDate as string) || "";
  if (admissionDate && !admissionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const d = new Date(admissionDate);
    admissionDate = !isNaN(d.getTime()) ? d.toISOString().split("T")[0] : "";
  }

  const cleanDx = (raw: string): string =>
    raw.replace(new RegExp("^(dx[-:\\s]*|ass[-:\\s]*|assessment[-:\\s]*)", "i"), "").trim();

  return {
    emrClinicalText,
    extracted: {
      name: (parsed.name as string) || "",
      age: (parsed.age as string) || "",
      gender: (parsed.gender as string) === "Male"
        ? "Male"
        : (parsed.gender as string) === "Female"
        ? "Female"
        : "" as Patient["gender"],
      ward: (parsed.ward as string) || "",
      bedNumber: (parsed.bedNumber as string) || "",
      admissionDate,
      initialDiagnosis: cleanDx((parsed.initialDiagnosis as string) || ""),
      currentDiagnosis: cleanDx((parsed.currentDiagnosis as string) || ""),
      doctorsPlan: (parsed.doctorsPlan as string) || "",
      medsAdministered: (parsed.medsAdministered as string) || "",
      vitals,
    },
    unreviewedResults: (parsed.unreviewedResults as string[]) || [],
    flags: (parsed.flags as string[]) || [],
    summary: (parsed.summary as string) || "",
  };
}

export async function extractFromText(rawText: string): Promise<EmrExtractResult> {
  if (!rawText || rawText.trim().length < 30) {
    throw new Error("Please enter at least some clinical text to extract from.");
  }

  const response = await fetch("/api/extract-emr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawText: rawText.trim() }),
  });

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
  const content = choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty response from AI. Please try again.");

  const emrClinicalText = (data.filteredText as string) || rawText;
  const parsed = parseJsonSafely(content);

  const rawVitals = (parsed.vitals as Record<string, string>) || {};
  const vitals = {
    bp: rawVitals.bp || "",
    pulse: rawVitals.pulse || "",
    respRate: rawVitals.respRate || "",
    temp: rawVitals.temp || "",
    spo2: rawVitals.spo2 || "",
    rbs: rawVitals.rbs || "",
  };

  let admissionDate = (parsed.admissionDate as string) || "";
  if (admissionDate && !admissionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const d = new Date(admissionDate);
    admissionDate = !isNaN(d.getTime()) ? d.toISOString().split("T")[0] : "";
  }

  const cleanDx = (raw: string): string =>
    raw.replace(new RegExp("^(dx[-:\\s]*|ass[-:\\s]*|assessment[-:\\s]*)", "i"), "").trim();

  return {
    emrClinicalText,
    extracted: {
      name: (parsed.name as string) || "",
      age: (parsed.age as string) || "",
      gender: (parsed.gender as string) === "Male"
        ? "Male"
        : (parsed.gender as string) === "Female"
        ? "Female"
        : "" as Patient["gender"],
      ward: (parsed.ward as string) || "",
      bedNumber: (parsed.bedNumber as string) || "",
      admissionDate,
      initialDiagnosis: cleanDx((parsed.initialDiagnosis as string) || ""),
      currentDiagnosis: cleanDx((parsed.currentDiagnosis as string) || ""),
      doctorsPlan: (parsed.doctorsPlan as string) || "",
      medsAdministered: (parsed.medsAdministered as string) || "",
      vitals,
    },
    unreviewedResults: (parsed.unreviewedResults as string[]) || [],
    flags: (parsed.flags as string[]) || [],
    summary: (parsed.summary as string) || "",
  };
}
