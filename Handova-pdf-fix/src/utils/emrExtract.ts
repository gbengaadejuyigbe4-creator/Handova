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

// Vercel rejects request bodies over ~4.5MB, and base64 adds about 33%.
// Keep uploads under 3MB so they always get through.
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_UPLOAD_LABEL = "3 MB";

const RESAVE_HINT =
  "Open the HMS page, press Ctrl+P, set Destination to \u201CSave as PDF\u201D " +
  "(not \u201CMicrosoft Print to PDF\u201D), then upload the new file.";

/**
 * \u201CMicrosoft Print to PDF\u201D turns every page into a picture, so the file has
 * no readable text and is very large. The producer name is stored near the end
 * of the file, so we only read the last 64KB plus the first 8KB.
 */
async function isImageOnlyPrintPdf(file: File): Promise<boolean> {
  try {
    const tail = await file.slice(Math.max(0, file.size - 65536)).arrayBuffer();
    const head = await file.slice(0, 8192).arrayBuffer();
    const decoder = new TextDecoder("latin1");
    return /Microsoft: Print To PDF/i.test(decoder.decode(head) + decoder.decode(tail));
  } catch {
    return false;
  }
}

function explainBadResponse(status: number): string {
  if (status === 413) {
    return `This file is too large for the server (limit ${MAX_UPLOAD_LABEL}). ${RESAVE_HINT}`;
  }
  if (status === 408 || status === 504) {
    return "The server took too long to respond. Please try again. If it keeps happening, upload a shorter PDF.";
  }
  if (status >= 500) {
    return `The server had a problem (error ${status}). Please try again in a moment.`;
  }
  return `Unexpected response from server (code ${status}). Please try again.`;
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

  if (await isImageOnlyPrintPdf(file)) {
    throw new Error(
      "This PDF was saved with \u201CMicrosoft Print to PDF\u201D, which turns the pages into pictures the app cannot read. " +
        RESAVE_HINT
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `This PDF is ${mb} MB, which is too large (limit ${MAX_UPLOAD_LABEL}). ` +
        "Very large PDFs are usually saved with \u201CMicrosoft Print to PDF\u201D. " +
        RESAVE_HINT
    );
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
    throw new Error(explainBadResponse(response.status));
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
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(`An image is too large (limit ${MAX_UPLOAD_LABEL}). Please use a smaller photo.`);
      }
      return {
        data: await fileToBase64(file),
        mediaType: file.type || "image/jpeg",
      };
    })
  );

  const totalSize = documents.reduce((acc, doc) => acc + doc.data.length, 0);
  if (totalSize > Math.ceil(MAX_UPLOAD_BYTES * 1.4)) {
    throw new Error(`Total upload is too large (limit ${MAX_UPLOAD_LABEL} in all). Please upload fewer or smaller images.`);
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
    throw new Error(explainBadResponse(response.status));
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
    throw new Error(explainBadResponse(response.status));
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
