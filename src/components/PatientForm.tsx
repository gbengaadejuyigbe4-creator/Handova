import { useState, useEffect } from "react";
import { Sparkles, ChevronDown, ChevronUp, Trash2, User, Activity, ChevronRight } from "lucide-react";
import VoiceInput from "./VoiceInput";
import EmrUpload from "./EmrUpload";
import ShiftQuestions from "./ShiftQuestions";
import { GENDERS, WARDS, CONDITION_OPTIONS, ARRIVAL_TYPES } from "../utils/clinicalConstants";
import { FORMAT_LABELS, type ReportFormat } from "../utils/reportFormatter";
import { getRegionConfig } from "../utils/regionConfig";
import { loadCustomWards } from "../utils/storage";
import { usePatientForm } from "../hooks/usePatientForm";
import type { ShiftHeader, VitalSigns, Patient, ConditionAtReport } from "../types";
import type { AppSettings } from "../utils/settings";

interface PatientFormProps {
  patientId: number;
  index: number;
  header: ShiftHeader;
  onUpdate: (id: number, data: Partial<Patient>) => void;
  onRemove: (id: number) => void;
  initialData?: Partial<Patient>;
  lang?: string;
  defaultFormat?: string;
  settings?: AppSettings;
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-[10px] font-700 text-slate-500 mb-1.5 uppercase tracking-widest">
        {label}{required && <span className="text-teal-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function ConditionBadge({ condition }: { condition: string }) {
  const map: Record<string, string> = {
    "Stable": "badge-stable",
    "Fair": "badge-fair",
    "Critical": "badge-critical",
    "Improving": "badge-improving",
    "Deteriorating": "badge-deteriorating",
  };
  const cls = map[condition] || "badge-fair";
  return (
    <span className={`${cls} text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider`}>
      {condition}
    </span>
  );
}

export default function PatientForm({ patientId, index, header, onUpdate, onRemove, initialData, defaultFormat: _defaultFormat, settings }: PatientFormProps) {
  const {
    data, setField, setVital,
    isGenerating, noteReady, error, expanded, toggleExpanded, generateNote,
    format, setFormat, applyEmrData,
    setShiftQuestions, setQuestionsLoading, updateQuestionAnswer, updateQuestionRecording,
  } = usePatientForm({ patientId, header, onUpdate, initialData, settings });

  const regionCfg = getRegionConfig(settings?.region || "ng");
  const availableFormats = regionCfg.formats as ReportFormat[];

  const [customWards, setCustomWards] = useState<string[]>([]);
  const [showOptional, setShowOptional] = useState(false);

  useEffect(() => { setCustomWards(loadCustomWards()); }, []);

  const inp = (key: keyof typeof data, placeholder: string, type = "text") => (
    <input
      type={type}
      value={(data[key] as string) || ""}
      onChange={e => setField(key, e.target.value as never)}
      onClick={type === "date" ? (e: React.MouseEvent<HTMLInputElement>) => (e.target as HTMLInputElement).showPicker?.() : undefined}
      placeholder={placeholder}
      className={`input-field${type === "date" ? " cursor-pointer" : ""}`}
    />
  );

  return (
    <div className={`overflow-hidden fade-up transition-all duration-300 ${
      noteReady ? "card note-ready-glow border-teal-500/25" : "card"
    }`}>

      {/* Collapsed header */}
      <div
        className="flex items-center justify-between cursor-pointer select-none -m-5 p-5 mb-0 rounded-t-2xl transition-colors duration-200 hover:bg-white/[0.02]"
        onClick={toggleExpanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
            noteReady ? "bg-teal-500/15 border border-teal-500/30" : "bg-slate-100 border border-slate-200"
          }`}>
            <User size={15} className={noteReady ? "text-teal-400" : "text-slate-500"} />
          </div>

          <div className="min-w-0">
            <p className="section-label text-[9px] mb-0.5">Inpatient {index + 1}</p>
            <p className="text-sm font-semibold text-slate-900 truncate leading-tight">
              {data.name || <span className="text-slate-600 font-normal italic">Unnamed patient</span>}
            </p>
            {data.currentDiagnosis && (
              <p className="text-[11px] text-slate-500 truncate mt-0.5 max-w-[180px]">
                {data.currentDiagnosis}
              </p>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            {data.conditionAtReport && <ConditionBadge condition={data.conditionAtReport} />}
            {noteReady && (
              <span className="inline-flex items-center gap-1 text-[10px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                {format !== "standard" ? `${format.toUpperCase()} ready` : "Note ready"}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
          <button
            onClick={e => { e.stopPropagation(); onRemove(patientId); }}
            className="w-8 h-8 flex items-center justify-center text-slate-700 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
          >
            <Trash2 size={13} />
          </button>
          <div className="w-7 h-7 flex items-center justify-center">
            {expanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
          </div>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="space-y-6 mt-6 pt-6 border-t border-slate-100">

          {/* EMR folio upload — optional, pre-fills form from HMS PDF */}
          <EmrUpload
            onExtracted={applyEmrData}
            onQuestionsGenerated={setShiftQuestions}
            onQuestionsLoading={setQuestionsLoading}
            patientIndex={index}
          />

          {/* Shift Assessment Questions — auto-generated from EMR, shown after Apply */}
          <ShiftQuestions
            questions={data.shiftQuestions || []}
            loading={data.questionsLoading || false}
            patientName={data.name}
            onAnswerChange={updateQuestionAnswer}
            onRecordingChange={updateQuestionRecording}
          />

          {/* FAST PATH — 3 required fields only */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <div style={{ width: '3px', height: '14px', background: 'linear-gradient(180deg, #14B8A6, #0F766E)', borderRadius: '2px', flexShrink: 0 }} />
              <span className="section-label">Patient essentials</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Patient name" required>
                {inp("name", "Full name or initials")}
              </Field>
              <Field label="Current diagnosis" required>
                <textarea
                  value={data.currentDiagnosis || ""}
                  onChange={e => setField("currentDiagnosis", e.target.value)}
                  placeholder="e.g. Hypertensive urgency"
                  rows={1}
                  className="input-field resize-none"
                />
              </Field>
            </div>

            <Field label="Doctor's ward round plan">
              <textarea
                value={data.doctorsPlan || ""}
                onChange={e => setField("doctorsPlan", e.target.value)}
                placeholder="Leave blank if doctor did not review — or type their plan here"
                rows={2}
                className="input-field resize-none"
              />
            </Field>
          </div>

          {/* Shift events */}
          <div>
            <div className="flex items-center justify-between mb-3" style={{ paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2">
                <div style={{ width: '3px', height: '14px', background: 'linear-gradient(180deg, #14B8A6, #0F766E)', borderRadius: '2px', flexShrink: 0 }} />
                <span className="section-label">Shift events</span>
                <span className="text-[10px] text-teal-600 normal-case tracking-normal font-normal">— raw notes for AI</span>
              </div>
              <VoiceInput onTranscript={t => setField("nursesNoteRaw", t)} existingText={data.nursesNoteRaw} disabled={isGenerating} />
            </div>
            <textarea
              value={data.nursesNoteRaw || ""}
              onChange={e => setField("nursesNoteRaw", e.target.value)}
              placeholder="Type or speak what happened — condition on takeover, IV lines, interventions, doctor review, medications given, complaints, response to treatment..."
              rows={5}
              className="input-field resize-y"
            />
            {error && (
              <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-red-400 flex-shrink-0" />
                {error}
              </p>
            )}

            {/* Format toggle + Generate */}
            <div className="mt-3 space-y-2">

              {/* Format toggle — region-aware pill switcher */}
              <div className="flex items-center justify-between rounded-xl px-4 py-3 border border-slate-200 bg-slate-50">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-slate-700">Output format</span>
                  <span className="text-[10px] text-slate-500 mt-0.5">
                    {FORMAT_LABELS[format]?.long || format.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center bg-slate-200 rounded-lg p-0.5 gap-0.5 flex-shrink-0 ml-4">
                  {availableFormats.map((f) => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 ${
                        format === f ? "bg-teal-500 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {FORMAT_LABELS[f]?.short || f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Generate button */}
              <button
                onClick={generateNote}
                disabled={isGenerating}
                className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 ${
                  isGenerating
                    ? "bg-teal-900/40 border border-teal-700/30 text-teal-600 cursor-not-allowed"
                    : "btn-primary btn-generate-idle"
                }`}
              >
                {isGenerating ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-teal-600 border-t-transparent spin-slow" />
                    Generating {format !== "standard" ? format.toUpperCase() + " " : ""}note…
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    Generate {format === "standard" ? "Nurses'" : format.toUpperCase()} Note
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Generated note */}
          {(isGenerating || noteReady) && (
            <div className={`rounded-xl overflow-hidden transition-all duration-300 ${noteReady ? "border border-teal-200 bg-teal-50" : "border border-slate-200"}`}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Activity size={12} className="text-teal-500" />
                  <p className="section-label text-[9px]">
                    {format !== "standard" ? `Generated ${format.toUpperCase()} Note` : "Generated Nurses' Note"}
                  </p>
                </div>
                {noteReady && (
                  <span className="check-in inline-flex items-center gap-1 text-[10px] text-teal-600 font-bold">
                    <Check size={11} strokeWidth={3} /> Ready
                  </span>
                )}
              </div>
              <div className="p-4">
                {isGenerating ? (
                  <div className="space-y-3">
                    {[92, 78, 85, 65, 88].map((w, i) => (
                      <div key={i} className="h-3 rounded-lg shimmer" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ) : (
                  <textarea
                    value={data.nursesNoteGenerated || ""}
                    onChange={e => setField("nursesNoteGenerated", e.target.value)}
                    rows={8}
                    className="w-full bg-transparent generated-note-text focus:outline-none resize-y"
                    style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.01em' }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Optional details — collapsible */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowOptional(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <ChevronRight
                  size={13}
                  className={`text-slate-500 transition-transform duration-200 ${showOptional ? "rotate-90" : ""}`}
                />
                <span className="text-xs font-semibold text-slate-400">Optional details</span>
                <span className="text-[10px] text-slate-600 normal-case">— demographics, bed, vitals, fluids, meds</span>
              </div>
              <span className="text-[10px] text-slate-600">{showOptional ? "collapse" : "expand"}</span>
            </button>

            {showOptional && (
              <div className="px-4 pb-5 space-y-7 border-t border-slate-100 pt-5">

                {/* Demographics */}
                <div>
                  <div className="section-tab mb-3"><span className="section-label">Demographics</span></div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Field label="Age (yrs)">{inp("age", "e.g. 45", "number")}</Field>
                    <Field label="Gender">
                      <select value={data.gender || ""} onChange={e => setField("gender", e.target.value as never)} className="select-field">
                        <option value="">Select</option>
                        {GENDERS.map(g => <option key={g}>{g}</option>)}
                      </select>
                    </Field>
                    <Field label="Ward">
                      <select value={data.ward || ""} onChange={e => setField("ward", e.target.value as never)} className="select-field">
                        <option value="">Select ward</option>
                        {customWards.length > 0 && (
                          <optgroup label="Saved Wards">
                            {customWards.map(w => <option key={`custom-${w}`}>{w}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="Standard Wards">
                          {WARDS.filter(w => w !== "Other").map(w => <option key={w}>{w}</option>)}
                        </optgroup>
                      </select>
                    </Field>
                    <Field label="Bed No.">{inp("bedNumber", "e.g. 3")}</Field>
                    <Field label="Admission Date">{inp("admissionDate", "", "date")}</Field>
                    <Field label="Discharge Date">{inp("dischargeDate", "", "date")}</Field>
                  </div>
                </div>

                {/* Arrival */}
                <div>
                  <div className="section-tab mb-3"><span className="section-label">Arrival / Takeover</span></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label="How did patient arrive this shift?">
                      <select value={data.arrivalType || ""} onChange={e => setField("arrivalType", e.target.value as never)} className="select-field">
                        <option value="">Select arrival type</option>
                        {ARRIVAL_TYPES.map(a => <option key={a}>{a}</option>)}
                      </select>
                    </Field>
                    {data.arrivalType === "Transfer in" && (
                      <Field label="Transferred from">
                        <input type="text" value={data.arrivalFrom || ""} onChange={e => setField("arrivalFrom", e.target.value)}
                          placeholder="e.g. Male Medical Ward, LUTH" className="input-field" />
                      </Field>
                    )}
                    {data.arrivalType === "Other" && (
                      <Field label="Specify arrival">
                        <input type="text" value={data.arrivalOther || ""} onChange={e => setField("arrivalOther", e.target.value)}
                          placeholder="Describe how patient arrived" className="input-field" />
                      </Field>
                    )}
                  </div>
                </div>

                {/* Additional diagnosis */}
                <div>
                  <div className="section-tab mb-3"><span className="section-label">Additional diagnosis info</span></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label="Initial Diagnosis">
                      <textarea value={data.initialDiagnosis || ""} onChange={e => setField("initialDiagnosis", e.target.value)}
                        placeholder="Initial diagnosis on admission" rows={2} className="input-field resize-none" />
                    </Field>
                    <Field label="Investigations">{inp("investigation", "e.g. FBC, PCV, E/U/Cr pending")}</Field>
                  </div>
                </div>

                {/* Fluids & Vitals */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className="section-tab mb-3"><span className="section-label">Fluids & Medications</span></div>
                    <Field label="IV Fluid">{inp("fluid", "e.g. IVF 0.9% N/S 1000mls or Nil")}</Field>
                    <div className="mt-3">
                      <Field label="Meds Administered">
                        <textarea
                          value={data.medsAdministered || ""}
                          onChange={e => setField("medsAdministered", e.target.value)}
                          placeholder={"Tab Amoxicillin 500mg\nIV Ceftriaxone 1g\nTab Paracetamol 1g"}
                          rows={5}
                          className="input-field resize-none font-mono text-xs"
                        />
                      </Field>
                    </div>
                  </div>

                  <div>
                    <div className="section-tab mb-3"><span className="section-label">Vital Signs at End of Shift</span></div>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { key: "bp", label: "BP", unit: "mmHg", placeholder: "120/80" },
                        { key: "pulse", label: "Pulse", unit: "bpm", placeholder: "80" },
                        { key: "respRate", label: "RR", unit: "cpm", placeholder: "18" },
                        { key: "temp", label: "Temp", unit: "°C", placeholder: "36.8" },
                        { key: "spo2", label: "SpO2", unit: "%", placeholder: "98" },
                        { key: "rbs", label: "RBS", unit: "mmol/L", placeholder: "5.4" },
                      ] as { key: keyof VitalSigns; label: string; unit: string; placeholder: string }[]).map(v => (
                        <div key={v.key} className="vital-cell">
                          <div className="vital-label">{v.label} <span className="opacity-50">· {v.unit}</span></div>
                          <input
                            type="text"
                            value={data.vitals?.[v.key] || ""}
                            onChange={e => setVital(v.key, e.target.value)}
                            placeholder={v.placeholder}
                            className="vital-input"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="mt-3">
                      <label className="block text-[10px] font-700 text-slate-500 mb-2 uppercase tracking-widest">Condition at Report</label>
                      <div className="flex flex-wrap gap-2">
                        {CONDITION_OPTIONS.map(c => {
                          const map: Record<string, string> = {
                            "Stable": "badge-stable", "Fair": "badge-fair", "Critical": "badge-critical",
                            "Improving": "badge-improving", "Deteriorating": "badge-deteriorating",
                          };
                          const isActive = data.conditionAtReport === c;
                          return (
                            <button
                              key={c}
                              onClick={() => setField("conditionAtReport", c as ConditionAtReport)}
                              className={`text-[11px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider transition-all duration-150 ${
                                isActive
                                  ? `${map[c]} scale-105 shadow-sm`
                                  : "bg-slate-50 border border-slate-200 text-slate-500 hover:border-teal-300 hover:text-slate-700"
                              }`}
                            >
                              {c}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

function Check({ size, strokeWidth }: { size: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth || 2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
