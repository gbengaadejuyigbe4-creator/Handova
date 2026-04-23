/**
 * EmrUpload.tsx — Handova v10.4
 *
 * EMR PDF upload with editable review step before applying to form.
 * Prevents inaccurate AI extractions (e.g. consultant name pulled as
 * patient name) from silently entering the report.
 *
 * Flow:
 *   Upload PDF → extraction runs → editable preview shown with warning
 *   → nurse corrects any errors inline → Confirm & Apply
 *   → form pre-filled + questions generated automatically
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useState, useRef, useCallback } from "react";
import {
  FileUp, X, Loader2, Sparkles, AlertCircle,
  ChevronDown, ChevronUp, PenLine, CheckCheck, FileText, Type, Image as ImageIcon
} from "lucide-react";
import { extractFromEmrPdf, extractFromText, extractFromImages } from "../utils/emrExtract";
import type { EmrExtractResult } from "../utils/emrExtract";
import type { ShiftQuestion } from "../types";

interface EmrUploadProps {
  onExtracted: (data: EmrExtractResult["extracted"] & {
    unreviewedResults?: string[];
    flags?: string[];
    pendingLabsNote?: string;
    emrClinicalText?: string;
  }) => void;
  onQuestionsGenerated: (questions: ShiftQuestion[]) => void;
  onQuestionsLoading: (loading: boolean) => void;
  patientIndex: number;
}

// Editable fields the nurse can correct before applying
interface EditableFields {
  name: string;
  currentDiagnosis: string;
  age: string;
  gender: string;
  admissionDate: string;
  doctorsPlan: string;
  medsAdministered: string;
}

export default function EmrUpload({
  onExtracted,
  onQuestionsGenerated,
  onQuestionsLoading,
  patientIndex,
}: EmrUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<EmrExtractResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [edits, setEdits] = useState<EditableFields | null>(null);
  const [inputMode, setInputMode] = useState<"pdf" | "image" | "file" | "type">("pdf");
  const [typedText, setTypedText] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const textFileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setError("");
    setFileName(file.name);
    setIsExtracting(true);
    setResult(null);
    setEdits(null);
    setApplied(false);

    try {
      const extracted = await extractFromEmrPdf(file);
      setResult(extracted);
      // Pre-populate editable fields from extraction
      setEdits({
        name: extracted.extracted.name || "",
        currentDiagnosis: extracted.extracted.currentDiagnosis || "",
        age: extracted.extracted.age || "",
        gender: (extracted.extracted.gender as string) || "",
        admissionDate: extracted.extracted.admissionDate || "",
        doctorsPlan: extracted.extracted.doctorsPlan || "",
        medsAdministered: extracted.extracted.medsAdministered || "",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Extraction failed. Please try again.";
      setError(msg);
    } finally {
      setIsExtracting(false);
    }
  }, []);

  const processText = async (text: string) => {
    setError("");
    setIsExtracting(true);
    setResult(null);
    setEdits(null);
    setApplied(false);
    try {
      const extracted = await extractFromText(text);
      setResult(extracted);
      setEdits({
        name: extracted.extracted.name || "",
        currentDiagnosis: extracted.extracted.currentDiagnosis || "",
        age: extracted.extracted.age || "",
        gender: (extracted.extracted.gender as string) || "",
        admissionDate: extracted.extracted.admissionDate || "",
        doctorsPlan: extracted.extracted.doctorsPlan || "",
        medsAdministered: extracted.extracted.medsAdministered || "",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Extraction failed. Please try again.";
      setError(msg);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleTextFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    processText(text);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files) {
      const files = Array.from(e.dataTransfer.files);
      if (inputMode === "image") {
        const imgs = files.filter(f => f.type.startsWith("image/"));
        if (imgs.length > 0) setImageFiles(prev => [...prev, ...imgs]);
      } else if (inputMode === "pdf" && files[0]?.type === "application/pdf") {
        processFile(files[0]);
      }
    }
  };

  const processImages = useCallback(async () => {
    if (imageFiles.length === 0) return;
    setError("");
    setFileName(`${imageFiles.length} image(s) processed`);
    setIsExtracting(true);
    setResult(null);
    setEdits(null);
    setApplied(false);

    try {
      const extracted = await extractFromImages(imageFiles);
      setResult(extracted);
      setEdits({
        name: extracted.extracted.name || "",
        currentDiagnosis: extracted.extracted.currentDiagnosis || "",
        age: extracted.extracted.age || "",
        gender: (extracted.extracted.gender as string) || "",
        admissionDate: extracted.extracted.admissionDate || "",
        doctorsPlan: extracted.extracted.doctorsPlan || "",
        medsAdministered: extracted.extracted.medsAdministered || "",
      });
      // Optional: Clear images after successful extraction, or keep them if they want to re-try.
      // We'll keep them so they can see what they uploaded.
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Image extraction failed. Please try again.";
      setError(msg);
    } finally {
      setIsExtracting(false);
    }
  }, [imageFiles]);

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).filter(f => f.type.startsWith("image/"));
      setImageFiles(prev => [...prev, ...newFiles]);
    }
    if (imageFileRef.current) imageFileRef.current.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (inputMode !== "image") return;
    const items = e.clipboardData.items;
    const pastedImages: File[] = [];
    for (let i = 0; i < items.length; i++) {
     if (items[i].type.indexOf("image") !== -1) {
       const file = items[i].getAsFile();
       if (file) pastedImages.push(file);
     }
    }
    if (pastedImages.length > 0) {
        setImageFiles(prev => [...prev, ...pastedImages]);
    }
  };

  const setEdit = (key: keyof EditableFields, value: string) => {
    setEdits(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const generateQuestions = useCallback(async (extracted: EmrExtractResult) => {
    onQuestionsLoading(true);
    try {
      const response = await fetch("/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extracted: extracted.extracted,
          filteredText: extracted.emrClinicalText || "",
        }),
      });

      let data: Record<string, unknown>;
      try {
        data = await response.json() as Record<string, unknown>;
      } catch {
        throw new Error("Could not parse questions response.");
      }

      if (!response.ok) {
        const msg = typeof data?.error === "string" ? data.error : "Question generation failed.";
        throw new Error(msg);
      }

      const rawQuestions = data.questions as string[] | undefined;
      if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
        throw new Error("No questions returned.");
      }

      const shiftQuestions: ShiftQuestion[] = rawQuestions.map((q, i) => ({
        id: i,
        question: q,
        answer: "",
        isRecording: false,
      }));

      onQuestionsGenerated(shiftQuestions);
    } catch (err) {
      console.error("[EmrUpload] Question generation error:", err);
      onQuestionsGenerated([]);
    } finally {
      onQuestionsLoading(false);
    }
  }, [onQuestionsGenerated, onQuestionsLoading]);

  const handleConfirmAndApply = () => {
    if (!result || !edits) return;

    const pendingLabsNote = result.unreviewedResults.length > 0
      ? `Pending unreviewed results: ${result.unreviewedResults.join("; ")}`
      : undefined;

    // Merge nurse's edits back over the extracted data before applying
    onExtracted({
      ...result.extracted,
      name: edits.name,
      currentDiagnosis: edits.currentDiagnosis,
      age: edits.age,
      gender: edits.gender as "Male" | "Female" | "",
      admissionDate: edits.admissionDate,
      doctorsPlan: edits.doctorsPlan,
      medsAdministered: edits.medsAdministered,
      unreviewedResults: result.unreviewedResults,
      flags: result.flags,
      pendingLabsNote,
      emrClinicalText: result.emrClinicalText || "",
    });

    setApplied(true);
    setIsOpen(false);

    // Trigger question generation with corrected data
    const correctedResult: EmrExtractResult = {
      ...result,
      extracted: {
        ...result.extracted,
        name: edits.name,
        currentDiagnosis: edits.currentDiagnosis,
        age: edits.age,
        gender: edits.gender as "Male" | "Female" | "",
        admissionDate: edits.admissionDate,
        doctorsPlan: edits.doctorsPlan,
        medsAdministered: edits.medsAdministered,
      },
    };
    generateQuestions(correctedResult);
  };

  const handleClear = () => {
    setResult(null);
    setEdits(null);
    setFileName("");
    setError("");
    setApplied(false);
    setImageFiles([]); // Clear images!
    onQuestionsGenerated([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="rounded-xl border border-dashed border-slate-200 overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setIsOpen(p => !p)}
        className={`w-full flex items-center justify-between px-4 py-3 transition-colors text-left ${
          applied ? "bg-teal-50 hover:bg-teal-50" : "hover:bg-slate-50"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
            applied ? "bg-teal-500 border border-teal-500" : "bg-teal-50 border border-teal-200"
          }`}>
            <FileUp size={12} className={applied ? "text-white" : "text-teal-600"} />
          </div>
          <div>
            <span className={`text-xs font-semibold ${applied ? "text-teal-700" : "text-slate-600"}`}>
              {applied ? "EMR applied — form pre-filled" : "Upload EMR folio"}
            </span>
            {!applied && (
              <span className="text-[10px] text-slate-400 ml-2">
                — optional, auto-fills form from HMS PDF
              </span>
            )}
            {applied && (
              <span className="text-[10px] text-teal-600 ml-2">— tap to view or re-upload</span>
            )}
          </div>
        </div>
        {isOpen
          ? <ChevronUp size={13} className="text-slate-400 flex-shrink-0" />
          : <ChevronDown size={13} className="text-slate-400 flex-shrink-0" />
        }
      </button>

      {isOpen && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-4 space-y-3">

          {/* Mode switcher */}
          {!result && !isExtracting && (
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {([
                { key: "pdf", label: "PDF", icon: <FileUp size={11} /> },
                { key: "image", label: "Image/Snip", icon: <ImageIcon size={11} /> },
                { key: "file", label: "Text file", icon: <FileText size={11} /> },
                { key: "type", label: "Type", icon: <Type size={11} /> },
              ] as const).map(m => (
                <button
                  key={m.key}
                  onClick={() => setInputMode(m.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-semibold transition-colors ${
                    inputMode === m.key
                      ? "bg-teal-600 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {m.icon}{m.label}
                </button>
              ))}
            </div>
          )}

          {/* PDF drop zone */}
          {!result && !isExtracting && inputMode === "pdf" && (
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
                isDragging
                  ? "border-teal-400 bg-teal-50"
                  : "border-slate-200 hover:border-teal-300 hover:bg-slate-50"
              }`}
            >
              <FileUp size={20} className={isDragging ? "text-teal-500" : "text-slate-400"} />
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-600">
                  {isDragging ? "Drop to upload" : "Drop EMR PDF here or tap to browse"}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Medikal HMS exports, patient history PDFs — up to 20MB
                </p>
              </div>
            </div>
          )}

          {/* Text/Word file upload */}
          {!result && !isExtracting && inputMode === "file" && (
            <div
              onClick={() => textFileRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed border-slate-200 hover:border-teal-300 hover:bg-slate-50 cursor-pointer transition-all duration-200"
            >
              <FileText size={20} className="text-slate-400" />
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-600">Upload .txt or .docx file</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Typed summaries, copied notes saved as text or Word
                </p>
              </div>
            </div>
          )}

          {/* Type directly */}
          {!result && !isExtracting && inputMode === "type" && (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500">
                Paste or type clinical text — diagnosis, medications, doctor's plan, vitals, anything from the folio.
              </p>
              <textarea
                value={typedText}
                onChange={e => setTypedText(e.target.value)}
                rows={8}
                placeholder={`Patient name:\nDiagnosis:\nDoctor's plan:\nMedications:\nVitals: BP  Pulse  Temp  SpO2\n...`}
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 bg-white text-slate-800 resize-none focus:outline-none focus:ring-1 focus:ring-teal-400 placeholder:text-slate-300 leading-relaxed"
              />
              <button
                onClick={() => { if (typedText.trim()) processText(typedText); }}
                disabled={!typedText.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white text-xs font-bold transition-colors"
              >
                <Sparkles size={12} />
                Extract from text
              </button>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Image Upload/Paste mode */}
          {!result && !isExtracting && inputMode === "image" && (
            <div className="space-y-3">
              <div
                onPaste={handlePaste}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => imageFileRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed border-slate-200 hover:border-teal-300 hover:bg-slate-50 cursor-pointer transition-all duration-200 text-center focus:outline-none focus:ring-2 focus:ring-teal-400"
                tabIndex={0}
              >
                <ImageIcon size={20} className="text-slate-400" />
                <p className="text-xs font-semibold text-slate-600">
                  Tap to upload, or click here and press <kbd className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-300 text-[10px]">Ctrl+V</kbd>
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Paste multiple screenshots from different EMR tabs
                </p>
              </div>

              {imageFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {imageFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 pr-1">
                        <ImageIcon size={10} className="text-teal-500" />
                        <span className="text-[10px] font-mono text-slate-600 max-w-[100px] truncate">
                          {f.name.replace("image.png", `Pasted Image ${i + 1}`)}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setImageFiles(prev => prev.filter((_, idx) => idx !== i)); }}
                          className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={processImages}
                    disabled={imageFiles.length === 0}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white text-xs font-bold transition-colors"
                  >
                    <Sparkles size={12} />
                    Extract from {imageFiles.length} image{imageFiles.length > 1 && "s"}
                  </button>
                </div>
              )}
            </div>
          )}

          <input
            ref={imageFileRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleImageFileChange}
            className="hidden"
          />

          <input
            ref={textFileRef}
            type="file"
            accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleTextFileChange}
            className="hidden"
          />

          {/* Extracting state */}
          {isExtracting && (
            <div className="flex flex-col items-center gap-3 py-6 bg-slate-50 rounded-xl border border-slate-200">
              <Loader2 size={22} className="text-teal-500 animate-spin" />
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-700">Reading EMR folio…</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Extracting clinical data from PDF
                </p>
              </div>
              {fileName && (
                <p className="text-[10px] text-slate-400 font-mono truncate max-w-[200px]">{fileName}</p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Editable preview — shown after extraction */}
          {result && edits && !isExtracting && (
            <div className="space-y-3">

              {/* Header */}
              <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Sparkles size={13} className="text-teal-600" />
                  <p className="text-xs font-semibold text-teal-800">
                    EMR extracted — Patient {patientIndex + 1}
                  </p>
                </div>
                <button onClick={handleClear} className="text-teal-500 hover:text-teal-700">
                  <X size={13} />
                </button>
              </div>

              {/* AI accuracy warning */}
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <PenLine size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-800 leading-relaxed">
                  <span className="font-bold">Review before applying.</span> AI extraction can make errors — check every field below and correct anything wrong before confirming.
                </p>
              </div>

              {/* Summary */}
              {result.summary && (
                <p className="text-xs text-slate-500 italic px-1 leading-relaxed">{result.summary}</p>
              )}

              {/* Editable fields */}
              <div className="space-y-2">
                <EditRow
                  label="Patient name"
                  value={edits.name}
                  onChange={v => setEdit("name", v)}
                  placeholder="Full patient name"
                  hint="Check this carefully — AI sometimes extracts doctor or consultant names"
                />
                <EditRow
                  label="Diagnosis"
                  value={edits.currentDiagnosis}
                  onChange={v => setEdit("currentDiagnosis", v)}
                  placeholder="Current diagnosis"
                  multiline
                />
                <div className="grid grid-cols-2 gap-2">
                  <EditRow
                    label="Age"
                    value={edits.age}
                    onChange={v => setEdit("age", v)}
                    placeholder="e.g. 45"
                  />
                  <EditRow
                    label="Gender"
                    value={edits.gender}
                    onChange={v => setEdit("gender", v)}
                    placeholder="Male / Female"
                    isSelect
                  />
                </div>
                <EditRow
                  label="Admission date"
                  value={edits.admissionDate}
                  onChange={v => setEdit("admissionDate", v)}
                  placeholder="YYYY-MM-DD"
                />
                <EditRow
                  label="Doctor's plan"
                  value={edits.doctorsPlan}
                  onChange={v => setEdit("doctorsPlan", v)}
                  placeholder="Doctor's ward round plan"
                  multiline
                />
                <EditRow
                  label="Active meds"
                  value={edits.medsAdministered}
                  onChange={v => setEdit("medsAdministered", v)}
                  placeholder="Medications administered"
                  multiline
                />
              </div>

              {/* Vitals — read only, shown for reference */}
              {result.extracted.vitals && Object.values(result.extracted.vitals).some(Boolean) && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Latest vitals (from HMS)
                  </p>
                  <p className="text-xs text-slate-600">
                    {[
                      result.extracted.vitals.bp && `BP ${result.extracted.vitals.bp}`,
                      result.extracted.vitals.pulse && `P ${result.extracted.vitals.pulse}`,
                      result.extracted.vitals.respRate && `R ${result.extracted.vitals.respRate}`,
                      result.extracted.vitals.temp && `T ${result.extracted.vitals.temp}°C`,
                      result.extracted.vitals.spo2 && `SpO2 ${result.extracted.vitals.spo2}%`,
                      result.extracted.vitals.rbs && `RBS ${result.extracted.vitals.rbs}`,
                    ].filter(Boolean).join("  ·  ")}
                  </p>
                </div>
              )}

              {/* Unreviewed results */}
              {result.unreviewedResults.length > 0 && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                  <AlertCircle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-1">
                      Unreviewed results — flag for doctor
                    </p>
                    {result.unreviewedResults.map((r, i) => (
                      <p key={i} className="text-xs text-amber-700 leading-relaxed">{r}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Clinical flags */}
              {result.flags.length > 0 && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  <AlertCircle size={13} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-bold text-red-800 uppercase tracking-wider mb-1">
                      Clinical flags
                    </p>
                    {result.flags.map((f, i) => (
                      <p key={i} className="text-xs text-red-700 leading-relaxed">{f}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Confirm & Apply button */}
              <button
                onClick={handleConfirmAndApply}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-colors"
              >
                <CheckCheck size={13} />
                Confirm & Apply to Patient {patientIndex + 1}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EDITABLE ROW ─────────────────────────────────────────────────────────────

interface EditRowProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  isSelect?: boolean;
  hint?: string;
}

function EditRow({ label, value, onChange, placeholder, multiline, isSelect, hint }: EditRowProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
          {label}
        </label>
        {hint && (
          <span className="text-[9px] text-amber-600 font-medium">{hint}</span>
        )}
      </div>
      {isSelect ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full text-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-none focus:border-teal-400"
        >
          <option value="">—</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      ) : multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full text-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 resize-none leading-relaxed focus:outline-none focus:border-teal-400 placeholder:text-slate-300"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full text-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 focus:outline-none focus:border-teal-400 placeholder:text-slate-300"
        />
      )}
    </div>
  );
}
