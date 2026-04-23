/**
 * ShiftPlanner.tsx — Handova v11.1
 *
 * Multi-patient shift planning with:
 * - Predictive clinical flags per patient (auto-generated from HMS PDF)
 * - Medication safety layer
 * - Continuity of care memory (returning patient detection)
 * - Time-structured evidence-based care plans
 * - Risk-stratified handover brief across all patients
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  FileUp, Loader2, AlertCircle, Clock, ClipboardList,
  Mic, Square, Copy, Check, AlertTriangle, ChevronDown,
  Stethoscope, Pill, Activity, FlaskConical, Heart,
  MessageSquare, BookOpen, X, Plus, Users, Shield,
  TriangleAlert, Eye, Zap, ChevronUp, History,
} from "lucide-react";
import { extractFromEmrPdf } from "../utils/emrExtract";
import { savePlannerEntry, loadPlannerHistory } from "../utils/storage";
import type { AppSettings } from "../utils/settings";

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface PlanItem {
  time: string;
  priority: "URGENT" | "HIGH" | "ROUTINE" | "PRN";
  category: string;
  intervention: string;
  rationale: string;
}

interface ClinicalFlag {
  title: string;
  detail: string;
  severity: "CRITICAL" | "HIGH" | "WATCH";
  action: string;
}

interface FlagsResult {
  flags: ClinicalFlag[];
  overallRisk: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  riskSummary: string;
}

interface DrugSafetyFlag {
  type: "DRUG_DRUG" | "DRUG_DISEASE" | "MISSING";
  flag: string;
  nursingAction: string;
  aiGenerated: boolean;
}

interface NursePriority {
  rank: number;
  priority: string;
  rationale: string;
}

interface ShiftPlan {
  summary: string;
  prognosisTrend?: "IMPROVING" | "DETERIORATING" | "STATIC" | "UNCERTAIN";
  clinicalTimeline?: string;
  nursePriorities?: NursePriority[];
  plan: PlanItem[];
  drugSafetyFlags?: DrugSafetyFlag[];
  escalationTriggers: string[];
  endOfShiftNote: string;
  nurseThinkingPrompt?: string;
  dataPrompts?: {
    field: string;
    question: string;
    clinicalReason: string;
    priority: "HIGH" | "MODERATE";
  }[];
}

interface HandoverBriefItem {
  patientName: string;
  priority: "IMMEDIATE" | "HIGH" | "WATCH" | "STABLE";
  emoji: string;
  firstAction: string;
  clinicalReason: string;
  pending: string;
}

interface HandoverBrief {
  brief: HandoverBriefItem[];
  wardOverview: string;
  mostImportant: string;
  shiftComplexity: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
}

interface ShiftUpdate {
  time: string;
  text: string;
}

interface PatientEntry {
  id: number;
  extracted: any;
  fileName: string;
  nurseQueries: string;
  plan: ShiftPlan | null;
  flags: FlagsResult | null;
  checkedItems: Set<number>;
  isExtracting: boolean;
  isGeneratingPlan: boolean;
  isGeneratingFlags: boolean;
  isUpdatingPlan: boolean;
  extractError: string;
  planError: string;
  updateError: string;
  expanded: boolean;
  continuityNote: string | null;
  updateHistory: ShiftUpdate[];
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  MEDICATION: <Pill size={11} />,
  MONITORING: <Activity size={11} />,
  ASSESSMENT: <Stethoscope size={11} />,
  INVESTIGATION: <FlaskConical size={11} />,
  COMFORT: <Heart size={11} />,
  COMMUNICATION: <MessageSquare size={11} />,
  EDUCATION: <BookOpen size={11} />,
};

const PRIORITY_STYLES: Record<string, string> = {
  URGENT: "bg-red-100 text-red-700 border-red-200",
  HIGH: "bg-amber-100 text-amber-700 border-amber-200",
  ROUTINE: "bg-teal-50 text-teal-700 border-teal-200",
  PRN: "bg-slate-100 text-slate-600 border-slate-200",
};

const CATEGORY_STYLES: Record<string, string> = {
  MEDICATION: "bg-indigo-50 text-indigo-700",
  MONITORING: "bg-blue-50 text-blue-700",
  ASSESSMENT: "bg-teal-50 text-teal-700",
  INVESTIGATION: "bg-purple-50 text-purple-700",
  COMFORT: "bg-pink-50 text-pink-700",
  COMMUNICATION: "bg-amber-50 text-amber-700",
  EDUCATION: "bg-green-50 text-green-700",
};

const SEVERITY_STYLES: Record<string, { bg: string; border: string; icon: string; badge: string }> = {
  CRITICAL: {
    bg: "bg-red-50",
    border: "border-red-200",
    icon: "text-red-600",
    badge: "bg-red-600 text-white",
  },
  HIGH: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    icon: "text-amber-600",
    badge: "bg-amber-500 text-white",
  },
  WATCH: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    icon: "text-blue-600",
    badge: "bg-blue-500 text-white",
  },
};

const RISK_COLOURS: Record<string, string> = {
  LOW: "bg-green-100 text-green-800 border-green-200",
  MODERATE: "bg-amber-100 text-amber-800 border-amber-200",
  HIGH: "bg-red-100 text-red-800 border-red-200",
  CRITICAL: "bg-red-600 text-white border-red-700",
};

const HANDOVER_PRIORITY_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  IMMEDIATE: { bg: "bg-red-50", border: "border-red-300", text: "text-red-800" },
  HIGH: { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-800" },
  WATCH: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-800" },
  STABLE: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800" },
};

// ─── UTILS ────────────────────────────────────────────────────────────────────

function getNow(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

let patientCounter = 0;
function newPatient(): PatientEntry {
  return {
    id: ++patientCounter,
    extracted: null,
    fileName: "",
    nurseQueries: "",
    plan: null,
    flags: null,
    checkedItems: new Set(),
    isExtracting: false,
    isGeneratingPlan: false,
    isGeneratingFlags: false,
    isUpdatingPlan: false,
    extractError: "",
    planError: "",
    updateError: "",
    expanded: true,
    continuityNote: null,
    updateHistory: [],
  };
}

// ─── VOICE HOOK for nurse queries (same pipeline as useVoiceInput) ─────────────

function useQuickVoice(onTranscript: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const silenceRef = useRef<number | null>(null);
  const autoStoppedRef = useRef(false);

  const teardown = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    silenceRef.current = null;
  }, []);

  const stop = useCallback(() => {
    teardown();
    setListening(false);
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
  }, [teardown]);

  const start = useCallback(async (existing: string) => {
    chunksRef.current = [];
    silenceRef.current = null;
    autoStoppedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      mimeRef.current = mimeType;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const baseMime = mimeRef.current.split(";")[0] || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: baseMime });
        if (blob.size < 500) return;
        setTranscribing(true);
        try {
          const ext = baseMime.includes("mp4") ? "mp4" : "webm";
          const form = new FormData();
          form.append("audio", blob, `recording.${ext}`);
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = await res.json();
          const transcript = (data.text || "").trim();
          if (transcript) {
            const prev = existing.trimEnd();
            onTranscript(prev ? prev + " " + transcript : transcript);
          }
        } catch { /* silent */ }
        finally { setTranscribing(false); }
      };
      recorder.start(200);
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const arr = new Uint8Array(analyser.frequencyBinCount);
      pollRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(arr);
        let sum = 0;
        for (let i = 0; i < arr.length; i++) { const v = (arr[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / arr.length) * 255;
        const now = Date.now();
        if (rms < 10) {
          if (!silenceRef.current) silenceRef.current = now;
          else if (now - silenceRef.current >= 1500 && !autoStoppedRef.current) {
            autoStoppedRef.current = true;
            stop();
          }
        } else { silenceRef.current = null; }
      }, 100);
      setListening(true);
    } catch { /* mic denied */ }
  }, [stop, onTranscript]);

  return { listening, transcribing, start, stop };
}

// ─── SUBCOMPONENTS ────────────────────────────────────────────────────────────

function PredictiveFlagsPanel({ flags }: { flags: FlagsResult }) {
  const [expanded, setExpanded] = useState(true);
  if (!flags.flags?.length) return null;

  return (
    <div className="rounded-xl overflow-hidden border border-red-200" style={{ background: '#FFF8F8' }}>
      <button
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        style={{ background: 'linear-gradient(135deg, #FFF1F2, #FFF8F8)' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-red-100 border border-red-200 flex items-center justify-center flex-shrink-0">
            <TriangleAlert size={13} className="text-red-600" />
          </div>
          <div>
            <span className="text-xs font-bold text-red-800">Predictive Clinical Flags</span>
            <span className="text-[11px] text-red-600 ml-2">— {flags.flags.length} flag{flags.flags.length !== 1 ? "s" : ""} detected</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${RISK_COLOURS[flags.overallRisk]}`}>
            {flags.overallRisk} RISK
          </span>
          {expanded ? <ChevronUp size={13} className="text-red-400" /> : <ChevronDown size={13} className="text-red-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 pt-1">
          <p className="text-[11px] text-red-700 italic leading-relaxed">{flags.riskSummary}</p>
          {flags.flags.map((flag, i) => {
            const style = SEVERITY_STYLES[flag.severity] || SEVERITY_STYLES.WATCH;
            return (
              <div key={i} className={`rounded-xl border ${style.border} ${style.bg} p-3.5 space-y-2`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield size={12} className={style.icon} />
                    <span className="text-xs font-bold text-slate-800">{flag.title}</span>
                  </div>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${style.badge}`}>
                    {flag.severity}
                  </span>
                </div>
                <p className="text-[11px] text-slate-700 leading-relaxed">{flag.detail}</p>
                <div className="flex items-start gap-1.5 pt-1 border-t border-slate-200">
                  <Zap size={10} className={`${style.icon} flex-shrink-0 mt-0.5`} />
                  <p className="text-[11px] font-semibold text-slate-700 leading-relaxed">{flag.action}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HandoverBriefPanel({
  brief,
  onCopy,
  copied,
}: {
  brief: HandoverBrief;
  onCopy: () => void;
  copied: boolean;
}) {
  const COMPLEXITY_COLOURS: Record<string, string> = {
    LOW: "bg-green-100 text-green-800",
    MODERATE: "bg-amber-100 text-amber-800",
    HIGH: "bg-red-100 text-red-800",
    CRITICAL: "bg-red-600 text-white",
  };

  return (
    <div className="rounded-2xl border border-indigo-200 overflow-hidden fade-up"
      style={{ background: 'linear-gradient(145deg, #EEF2FF, #FFFFFF)', boxShadow: '0 4px 24px rgba(99,102,241,0.10)' }}>

      {/* Header */}
      <div className="px-5 py-4 border-b border-indigo-100 flex items-center justify-between"
        style={{ background: 'linear-gradient(135deg, #EEF2FF, #E0E7FF)' }}>
        <div className="flex items-center gap-3">
          <div className="icon-container-indigo">
            <ClipboardList size={16} className="text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-indigo-900">Handover Brief</p>
            <p className="text-[11px] text-indigo-600 mt-0.5">Risk-stratified · {brief.brief.length} patient{brief.brief.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${COMPLEXITY_COLOURS[brief.shiftComplexity]}`}>
            {brief.shiftComplexity} complexity
          </span>
          <button onClick={onCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors">
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy brief"}
          </button>
        </div>
      </div>

      {/* Most important */}
      <div className="px-5 py-3 border-b border-indigo-100"
        style={{ background: 'rgba(99,102,241,0.04)' }}>
        <div className="flex items-start gap-2">
          <Zap size={13} className="text-indigo-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-bold text-indigo-800 leading-relaxed">{brief.mostImportant}</p>
        </div>
      </div>

      {/* Patient list */}
      <div className="divide-y divide-indigo-50">
        {brief.brief.map((item, i) => {
          const style = HANDOVER_PRIORITY_STYLES[item.priority] || HANDOVER_PRIORITY_STYLES.STABLE;
          return (
            <div key={i} className={`px-5 py-4 ${style.bg}`}>
              <div className="flex items-start gap-3">
                <span className="text-xl flex-shrink-0">{item.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className={`text-xs font-bold ${style.text}`}>{item.patientName}</p>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border ${style.border} ${style.text}`}>
                      {item.priority}
                    </span>
                  </div>
                  <p className="text-xs text-slate-800 leading-relaxed mb-1">
                    <span className="font-semibold">Action: </span>{item.firstAction}
                  </p>
                  <p className="text-[11px] text-slate-600 leading-relaxed mb-1">
                    <span className="font-semibold">Why: </span>{item.clinicalReason}
                  </p>
                  {item.pending && (
                    <p className="text-[11px] text-amber-700 leading-relaxed">
                      <span className="font-semibold">Pending: </span>{item.pending}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ward overview */}
      <div className="px-5 py-3 border-t border-indigo-100">
        <p className="text-[11px] text-indigo-700 leading-relaxed italic">{brief.wardOverview}</p>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

interface ShiftPlannerProps {
  settings: AppSettings;
}

export default function ShiftPlanner({ settings }: ShiftPlannerProps) {
  const [shiftStart, setShiftStart] = useState(settings.shiftStartTime || "");
  const [shiftEnd, setShiftEnd] = useState(settings.shiftEndTime || "");
  const [nurseCount, setNurseCount] = useState("");
  const [totalPatients, setTotalPatients] = useState("");
  const [currentTime, setCurrentTime] = useState(getNow());

  const [patients, setPatients] = useState<PatientEntry[]>([newPatient()]);

  const [handoverBrief, setHandoverBrief] = useState<HandoverBrief | null>(null);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [briefError, setBriefError] = useState("");
  const [briefCopied, setBriefCopied] = useState(false);

  const fileRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(getNow()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (settings.shiftStartTime && !shiftStart) setShiftStart(settings.shiftStartTime);
    if (settings.shiftEndTime && !shiftEnd) setShiftEnd(settings.shiftEndTime);
  }, [settings]);

  const updatePatient = useCallback((id: number, updates: Partial<PatientEntry>) => {
    setPatients(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  // Check continuity of care — has this patient appeared in records before?
  const checkContinuity = useCallback((id: number, patientName: string, _diagnosis: string) => {
    if (!patientName) return;
    const history = loadPlannerHistory();
    const previous = history.find(h =>
      h.patientName?.toLowerCase().includes(patientName.toLowerCase().split(" ")[0]) ||
      patientName.toLowerCase().includes((h.patientName || "").toLowerCase().split(" ")[0])
    );
    if (previous) {
      const savedAt = new Date(previous.savedAt).toLocaleDateString("en-NG", {
        day: "2-digit", month: "short", year: "numeric",
      });
      updatePatient(id, {
        continuityNote: `You have a previous care plan for this patient from ${savedAt}. Last recorded diagnosis: ${previous.diagnosis || "—"}. Review your Records for full history.`,
      });
    }
  }, [updatePatient]);

  const processFile = useCallback(async (patientId: number, file: File) => {
    updatePatient(patientId, {
      extractError: "", fileName: file.name,
      isExtracting: true, extracted: null,
      plan: null, flags: null,
      checkedItems: new Set(), continuityNote: null,
    });

    try {
      const result = await extractFromEmrPdf(file);
      updatePatient(patientId, { extracted: result, isExtracting: false });

      // Check continuity
      checkContinuity(patientId, result.extracted?.name || "", result.extracted?.currentDiagnosis || "");

      // Generate flags automatically
      generateFlags(patientId, result);

    } catch (e) {
      updatePatient(patientId, {
        extractError: e instanceof Error ? e.message : "Extraction failed.",
        isExtracting: false,
      });
    }
  }, [updatePatient, checkContinuity]);

  const generateFlags = useCallback(async (patientId: number, extracted: any) => {
    updatePatient(patientId, { isGeneratingFlags: true });
    try {
      const response = await fetch("/api/predict-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extracted: extracted.extracted,
          filteredText: extracted.emrClinicalText || "",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Flag generation failed.");
      updatePatient(patientId, { flags: data as FlagsResult });
    } catch (err) {
      console.error("[ShiftPlanner] Flags error:", err);
      // Silent fail — flags are additive, not blocking
    } finally {
      updatePatient(patientId, { isGeneratingFlags: false });
    }
  }, [updatePatient]);

  const generatePlan = useCallback(async (patientId: number) => {
    const patient = patients.find(p => p.id === patientId);
    if (!patient?.extracted) return;

    updatePatient(patientId, { isGeneratingPlan: true, planError: "", plan: null, checkedItems: new Set() });

    try {
      const response = await fetch("/api/plan-shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extracted: {
            ...patient.extracted.extracted,
            allMedications: patient.extracted.extracted?.allMedications || patient.extracted.extracted?.medsAdministered || "",
            prognosisTrend: patient.extracted.extracted?.prognosisTrend || "",
            clinicalTimeline: patient.extracted.extracted?.clinicalTimeline || "",
            surgeryName: patient.extracted.extracted?.surgeryName || "",
          },
          filteredText: patient.extracted.emrClinicalText || patient.extracted.filteredText || "",
          shiftStart, shiftEnd, currentTime,
          nurseQueries: patient.nurseQueries,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Plan generation failed.");

      const plan = data as ShiftPlan;
      updatePatient(patientId, { plan });

      // Auto-save to planner history
      savePlannerEntry({
        patientName: patient.extracted.extracted?.name || "Unknown",
        diagnosis: patient.extracted.extracted?.currentDiagnosis || "",
        shiftStart: shiftStart || "",
        shiftEnd: shiftEnd || "",
        ward: patient.extracted.extracted?.ward || "",
        plan,
      });

    } catch (err) {
      updatePatient(patientId, {
        planError: err instanceof Error ? err.message : "Plan generation failed.",
      });
    } finally {
      updatePatient(patientId, { isGeneratingPlan: false });
    }
  }, [patients, shiftStart, shiftEnd, currentTime, updatePatient]);

  const updatePatientPlan = useCallback(async (patientId: number, newUpdateText: string) => {
    const patient = patients.find(p => p.id === patientId);
    if (!patient?.extracted || !patient?.plan) return;

    const newUpdate: ShiftUpdate = {
      time: currentTime || new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      text: newUpdateText,
    };

    updatePatient(patientId, { isUpdatingPlan: true, updateError: "" });

    try {
      const response = await fetch("/api/shift-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extracted: {
            ...patient.extracted.extracted,
            allMedications: patient.extracted.extracted?.allMedications || patient.extracted.extracted?.medsAdministered || "",
            prognosisTrend: patient.extracted.extracted?.prognosisTrend || "",
            clinicalTimeline: patient.extracted.extracted?.clinicalTimeline || "",
            surgeryName: patient.extracted.extracted?.surgeryName || "",
          },
          filteredText: patient.extracted.emrClinicalText || patient.extracted.filteredText || "",
          originalPlan: patient.plan,
          updateHistory: patient.updateHistory || [],
          newUpdate,
          shiftStart, shiftEnd, currentTime,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Plan update failed.");

      // Build revised plan from update response
      const revisedPlan: ShiftPlan = {
        summary: data.updatedSummary || patient.plan.summary,
        prognosisTrend: data.updatedPrognosisTrend || patient.plan.prognosisTrend,
        clinicalTimeline: patient.plan.clinicalTimeline,
        nursePriorities: data.nursePriorities || patient.plan.nursePriorities,
        plan: data.revisedPlan || patient.plan.plan,
        drugSafetyFlags: patient.plan.drugSafetyFlags,
        escalationTriggers: data.updatedEscalationTriggers || patient.plan.escalationTriggers,
        endOfShiftNote: data.endOfShiftNote || patient.plan.endOfShiftNote,
        nurseThinkingPrompt: data.nurseThinkingPrompt || patient.plan.nurseThinkingPrompt,
      };

      updatePatient(patientId, {
        plan: revisedPlan,
        updateHistory: [...(patient.updateHistory || []), newUpdate],
        checkedItems: new Set(),
      });

      // If escalation needed, flag it prominently
      if (data.escalate) {
        updatePatient(patientId, {
          updateError: `🚨 ESCALATE NOW: ${data.escalationReason}`,
        });
      }

    } catch (err) {
      updatePatient(patientId, {
        updateError: err instanceof Error ? err.message : "Plan update failed.",
      });
    } finally {
      updatePatient(patientId, { isUpdatingPlan: false });
    }
  }, [patients, shiftStart, shiftEnd, currentTime, updatePatient]);

  const generateHandoverBrief = useCallback(async () => {
    const patientsWithPlans = patients.filter(p => p.plan !== null);
    if (patientsWithPlans.length === 0) return;

    setIsGeneratingBrief(true);
    setBriefError("");
    setHandoverBrief(null);

    try {
      const patientData = patientsWithPlans.map(p => ({
        name: p.extracted?.extracted?.name || "Unknown",
        diagnosis: p.extracted?.extracted?.currentDiagnosis || "",
        planSummary: p.plan?.summary || "",
        flags: p.flags?.flags || [],
        overallRisk: p.flags?.overallRisk || "UNKNOWN",
        endOfShiftNote: p.plan?.endOfShiftNote || "",
        checkedCount: p.checkedItems.size,
        totalCount: p.plan?.plan?.length || 0,
      }));

      const response = await fetch("/api/handover-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patients: patientData,
          shiftStart, shiftEnd, nurseCount, totalPatients,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Brief generation failed.");
      setHandoverBrief(data as HandoverBrief);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : "Brief generation failed.");
    } finally {
      setIsGeneratingBrief(false);
    }
  }, [patients, shiftStart, shiftEnd, nurseCount, totalPatients]);

  const copyBrief = useCallback(() => {
    if (!handoverBrief) return;
    const text = [
      "HANDOVER BRIEF",
      `Shift: ${shiftStart || "—"} – ${shiftEnd || "—"} · Complexity: ${handoverBrief.shiftComplexity}`,
      "",
      `⚡ ${handoverBrief.mostImportant}`,
      "",
      ...handoverBrief.brief.map(b => [
        `${b.emoji} ${b.patientName} — ${b.priority}`,
        `  Action: ${b.firstAction}`,
        `  Why: ${b.clinicalReason}`,
        b.pending ? `  Pending: ${b.pending}` : "",
      ].filter(Boolean).join("\n")),
      "",
      handoverBrief.wardOverview,
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setBriefCopied(true);
      setTimeout(() => setBriefCopied(false), 2500);
    });
  }, [handoverBrief, shiftStart, shiftEnd]);

  const patientsWithPlans = patients.filter(p => p.plan !== null);
  const canGenerateBrief = patientsWithPlans.length >= 1;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="fade-up">
        <div className="flex items-center gap-2 mb-1">
          <div className="icon-container-indigo" style={{ width: 32, height: 32, borderRadius: 11 }}>
            <ClipboardList size={15} className="text-indigo-600" />
          </div>
          <span className="section-label text-indigo-700">Shift Planner</span>
        </div>
        <h1 className="font-display text-3xl font-semibold text-slate-900 mb-1">Nursing Care Plans</h1>
        <p className="text-sm text-slate-500">
          Upload each patient's HMS PDF. Predictive flags, evidence-based care plans, and a risk-stratified handover brief — all generated automatically.
        </p>
      </div>

      {/* Shift context */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-teal-600" />
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Shift Context</span>
          <span className="ml-auto text-[11px] text-slate-400 font-mono">Now: {currentTime}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">Shift Start</label>
            <input type="time" value={shiftStart} onChange={e => setShiftStart(e.target.value)} className="input-field cursor-pointer" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">Shift End</label>
            <input type="time" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)} className="input-field cursor-pointer" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">
              <Users size={9} className="inline mr-1" />Nurses on duty
            </label>
            <input type="number" min="1" max="20" value={nurseCount} onChange={e => setNurseCount(e.target.value)}
              placeholder="e.g. 2" className="input-field" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">Total ward patients</label>
            <input type="number" min="1" max="50" value={totalPatients} onChange={e => setTotalPatients(e.target.value)}
              placeholder="e.g. 8" className="input-field" />
          </div>
        </div>
        {(!nurseCount || !totalPatients) && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1">
            <AlertTriangle size={10} />
            Add nurse count and total patients for a more intelligent care plan and handover brief.
          </p>
        )}
      </div>

      {/* Patient cards */}
      {patients.map((patient, pIndex) => (
        <PatientCard
          key={patient.id}
          patient={patient}
          pIndex={pIndex}
          shiftStart={shiftStart}
          shiftEnd={shiftEnd}
          currentTime={currentTime}
          fileRefs={fileRefs}
          onUpdate={updatePatient}
          onProcessFile={processFile}
          onGeneratePlan={generatePlan}
          onUpdatePlan={updatePatientPlan}
          onGenerateFlags={generateFlags}
          onCheckContinuity={checkContinuity}
        />
      ))}

      {/* Add patient */}
      <button
        onClick={() => setPatients(prev => [...prev, newPatient()])}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-dashed border-indigo-200 text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50/50 transition-all text-sm font-semibold"
      >
        <Plus size={15} /> Add Another Patient
      </button>

      {/* Handover Brief section */}
      {canGenerateBrief && (
        <div className="space-y-4">
          <div className="border-t border-slate-200 pt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-bold text-slate-800">Handover Brief</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Risk-stratified summary across {patientsWithPlans.length} patient{patientsWithPlans.length !== 1 ? "s" : ""} with care plans
                </p>
              </div>
              <button
                onClick={generateHandoverBrief}
                disabled={isGeneratingBrief}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  isGeneratingBrief
                    ? "bg-indigo-100 text-indigo-400 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200"
                }`}
              >
                {isGeneratingBrief ? (
                  <><Loader2 size={14} className="animate-spin" /> Generating…</>
                ) : (
                  <><ClipboardList size={14} /> Generate Handover Brief</>
                )}
              </button>
            </div>

            {briefError && (
              <div className="error-card mb-4">
                <div className="error-card-icon"><AlertCircle size={14} className="text-red-600" /></div>
                <div>
                  <p className="error-card-title">Brief generation failed</p>
                  <p className="error-card-desc">{briefError}</p>
                  <button onClick={generateHandoverBrief} className="error-card-action">Try again</button>
                </div>
              </div>
            )}

            {handoverBrief && (
              <HandoverBriefPanel
                brief={handoverBrief}
                onCopy={copyBrief}
                copied={briefCopied}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PATIENT CARD ─────────────────────────────────────────────────────────────

interface PatientCardProps {
  patient: PatientEntry;
  pIndex: number;
  shiftStart: string;
  shiftEnd: string;
  currentTime: string;
  fileRefs: React.MutableRefObject<Map<number, HTMLInputElement>>;
  onUpdate: (id: number, updates: Partial<PatientEntry>) => void;
  onProcessFile: (id: number, file: File) => void;
  onGeneratePlan: (id: number) => void;
  onUpdatePlan: (id: number, updateText: string) => void;
  onGenerateFlags: (id: number, extracted: any) => void;
  onCheckContinuity: (id: number, patientName: string, diagnosis: string) => void;
}

function PatientCard({
  patient, pIndex, shiftStart, currentTime,
  fileRefs, onUpdate, onProcessFile, onGeneratePlan, onUpdatePlan,
  onGenerateFlags, onCheckContinuity,
}: PatientCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [noteCopied, setNoteCopied] = useState(false);
  const [inputMode, setInputMode] = useState<"pdf" | "file" | "type">("pdf");
  const [typedText, setTypedText] = useState("");
  const [isProcessingText, setIsProcessingText] = useState(false);
  const [midShiftUpdate, setMidShiftUpdate] = useState("");
  const [showUpdateInput, setShowUpdateInput] = useState(false);
  const textFileRef = useRef<HTMLInputElement>(null);
  const updateVoice = useQuickVoice(text => setMidShiftUpdate(prev => prev ? prev + " " + text : text));

  const voice = useQuickVoice(text => {
    onUpdate(patient.id, { nurseQueries: text });
  });

  const patientName = patient.extracted?.extracted?.name;
  const diagnosis = patient.extracted?.extracted?.currentDiagnosis;

  const toggleItem = (index: number) => {
    const next = new Set(patient.checkedItems);
    if (next.has(index)) next.delete(index); else next.add(index);
    onUpdate(patient.id, { checkedItems: next });
  };

  const copyNote = () => {
    if (!patient.plan?.endOfShiftNote) return;
    navigator.clipboard.writeText(patient.plan.endOfShiftNote).then(() => {
      setNoteCopied(true);
      setTimeout(() => setNoteCopied(false), 2500);
    });
  };

  return (
    <div className="card space-y-4 fade-up">
      {/* Card header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="icon-container-indigo" style={{ width: 32, height: 32, borderRadius: 11 }}>
            <span className="text-xs font-bold text-indigo-700">{pIndex + 1}</span>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">{patientName || `Patient ${pIndex + 1}`}</p>
            {diagnosis && <p className="text-[11px] text-slate-500 truncate max-w-[240px] mt-0.5">{diagnosis}</p>}
          </div>
        </div>
        <button
          onClick={() => onUpdate(patient.id, { expanded: !patient.expanded })}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
        >
          {patient.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {patient.expanded && (
        <>
          {/* Continuity note */}
          {patient.continuityNote && (
            <div className="flex items-start gap-2.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5">
              <History size={13} className="text-teal-600 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-teal-800 leading-relaxed">{patient.continuityNote}</p>
            </div>
          )}

          {/* Input mode switcher */}
          {!patient.extracted && !patient.isExtracting && !isProcessingText && (
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {([
                { key: "pdf", label: "PDF" },
                { key: "file", label: "Text/Word" },
                { key: "type", label: "Type directly" },
              ] as const).map(m => (
                <button
                  key={m.key}
                  onClick={() => setInputMode(m.key)}
                  className={`flex-1 py-2 text-[10px] font-semibold transition-colors ${
                    inputMode === m.key ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {/* PDF Upload */}
          {!patient.extracted && !patient.isExtracting && !isProcessingText && inputMode === "pdf" && (
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={e => {
                e.preventDefault(); setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) onProcessFile(patient.id, file);
              }}
              onClick={() => fileRefs.current.get(patient.id)?.click()}
              className={`flex flex-col items-center justify-center gap-2 py-7 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                isDragging ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50"
              }`}
            >
              <FileUp size={20} className={isDragging ? "text-indigo-500" : "text-slate-400"} />
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-600">Drop patient HMS PDF or tap to browse</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Medikal HMS export — up to 20MB</p>
              </div>
            </div>
          )}

          {/* Text/Word file upload */}
          {!patient.extracted && !patient.isExtracting && !isProcessingText && inputMode === "file" && (
            <div
              onClick={() => textFileRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 py-7 rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50 cursor-pointer transition-all"
            >
              <FileUp size={20} className="text-slate-400" />
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-600">Upload .txt or .docx file</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Typed summaries or copied notes</p>
              </div>
            </div>
          )}

          {/* Type directly */}
          {!patient.extracted && !patient.isExtracting && !isProcessingText && inputMode === "type" && (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500">Paste or type clinical text — diagnosis, medications, doctor's plan, vitals.</p>
              <textarea
                value={typedText}
                onChange={e => setTypedText(e.target.value)}
                rows={7}
                placeholder={`Patient name:\nDiagnosis:\nDoctor's plan:\nMedications:\nVitals: BP  Pulse  Temp  SpO2`}
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 bg-white text-slate-800 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 placeholder:text-slate-300 leading-relaxed"
              />
              <button
                onClick={async () => {
                  if (!typedText.trim()) return;
                  setIsProcessingText(true);
                  try {
                    const { extractFromText } = await import("../utils/emrExtract");
                    const result = await extractFromText(typedText);
                    onUpdate(patient.id, {
                      extracted: result,
                      fileName: "typed-input",
                    });
                    
                    // Trigger predictive flags and continuity checking
                    onCheckContinuity(patient.id, result.extracted?.name || "", result.extracted?.currentDiagnosis || "");
                    onGenerateFlags(patient.id, result);
                  } catch(e) {
                    onUpdate(patient.id, { extractError: e instanceof Error ? e.message : "Extraction failed" });
                  } finally {
                    setIsProcessingText(false);
                  }
                }}
                disabled={!typedText.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold transition-colors"
              >
                Extract from text
              </button>
            </div>
          )}

          {/* Processing text */}
          {isProcessingText && (
            <div className="flex items-center gap-3 py-5 rounded-xl bg-slate-50 border border-slate-200 justify-center">
              <Loader2 size={18} className="text-indigo-500 animate-spin" />
              <p className="text-xs font-semibold text-slate-700">Reading clinical text…</p>
            </div>
          )}

          <input
            ref={el => { if (el) fileRefs.current.set(patient.id, el); }}
            type="file" accept=".pdf,application/pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onProcessFile(patient.id, f); }}
          />

          <input
            ref={textFileRef}
            type="file" accept=".txt,.docx,text/plain" className="hidden"
            onChange={async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              setIsProcessingText(true);
              try {
                const text = await f.text();
                const { extractFromText } = await import("../utils/emrExtract");
                const result = await extractFromText(text);
                onUpdate(patient.id, { extracted: result, fileName: f.name });
                
                // Trigger predictive flags and continuity checking
                onCheckContinuity(patient.id, result.extracted?.name || "", result.extracted?.currentDiagnosis || "");
                onGenerateFlags(patient.id, result);
              } catch(err) {
                onUpdate(patient.id, { extractError: err instanceof Error ? err.message : "Extraction failed" });
              } finally {
                setIsProcessingText(false);
              }
            }}
          />

          {/* Extracting */}
          {patient.isExtracting && (
            <div className="flex items-center gap-3 py-5 rounded-xl bg-slate-50 border border-slate-200 justify-center">
              <Loader2 size={18} className="text-indigo-500 animate-spin" />
              <div>
                <p className="text-xs font-semibold text-slate-700">Reading HMS record…</p>
                <p className="text-[11px] text-slate-400 font-mono mt-0.5">{patient.fileName}</p>
              </div>
            </div>
          )}

          {/* Extract error */}
          {patient.extractError && (
            <div className="error-card">
              <div className="error-card-icon"><AlertCircle size={14} className="text-red-600" /></div>
              <div>
                <p className="error-card-title">Extraction failed</p>
                <p className="error-card-desc">{patient.extractError}</p>
              </div>
            </div>
          )}

          {/* Extracted */}
          {patient.extracted && !patient.isExtracting && (
            <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5">
              <div>
                <p className="text-xs font-bold text-indigo-800">{patientName || "Patient loaded"}</p>
                {diagnosis && <p className="text-[11px] text-indigo-600 mt-0.5 truncate max-w-[240px]">{diagnosis}</p>}
              </div>
              <button onClick={() => {
                onUpdate(patient.id, { extracted: null, plan: null, flags: null, fileName: "", continuityNote: null });
              }} className="text-indigo-400 hover:text-indigo-700">
                <X size={13} />
              </button>
            </div>
          )}

          {/* Flags loading */}
          {patient.isGeneratingFlags && (
            <div className="flex items-center gap-2.5 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
              <Loader2 size={13} className="text-red-500 animate-spin" />
              <p className="text-[11px] text-red-700 font-semibold">Analysing clinical risk factors…</p>
            </div>
          )}

          {/* Predictive flags */}
          {patient.flags && !patient.isGeneratingFlags && (
            <PredictiveFlagsPanel flags={patient.flags} />
          )}

          {/* Nurse queries */}
          {patient.extracted && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye size={13} className="text-teal-600" />
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Current Patient Status</span>
                </div>
                <button
                  onClick={() => voice.listening ? voice.stop() : voice.start(patient.nurseQueries)}
                  disabled={voice.transcribing}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    voice.listening
                      ? "bg-red-500 text-white recording-pulse"
                      : voice.transcribing
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200"
                  }`}
                >
                  {voice.listening ? <><Square size={11} fill="currentColor" /> Stop</> :
                   voice.transcribing ? <><Loader2 size={11} className="animate-spin" /> Transcribing…</> :
                   <><Mic size={11} /> Speak</>}
                </button>
              </div>
              {voice.listening && (
                <p className="text-[11px] text-red-500 flex items-center gap-1.5 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  Recording — pause to auto-stop
                </p>
              )}
              <textarea
                value={patient.nurseQueries}
                onChange={e => onUpdate(patient.id, { nurseQueries: e.target.value })}
                placeholder="Current IV line status, new complaints, verbal doctor instructions, anything not in the HMS…"
                rows={3}
                className="input-field resize-none"
              />
            </div>
          )}

          {/* Generate plan button */}
          {patient.extracted && (
            <button
              onClick={() => onGeneratePlan(patient.id)}
              disabled={patient.isGeneratingPlan}
              className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-bold text-sm transition-all ${
                patient.isGeneratingPlan
                  ? "bg-indigo-100 text-indigo-400 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200"
              }`}
            >
              {patient.isGeneratingPlan ? (
                <><Loader2 size={15} className="animate-spin" /> Generating care plan…</>
              ) : (
                <><ClipboardList size={15} /> {patient.plan ? "Regenerate Care Plan" : "Generate Care Plan"}</>
              )}
            </button>
          )}

          {/* Plan error */}
          {patient.planError && (
            <div className="error-card">
              <div className="error-card-icon"><AlertCircle size={14} className="text-red-600" /></div>
              <div>
                <p className="error-card-title">Plan generation failed</p>
                <p className="error-card-desc">{patient.planError}</p>
                <button onClick={() => onGeneratePlan(patient.id)} className="error-card-action">Try again</button>
              </div>
            </div>
          )}

          {/* Care plan output */}
          {patient.plan && (
            <div className="space-y-3 fade-up">
              {/* Summary */}
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                <p className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider mb-1">Clinical Summary</p>
                <p className="text-xs text-indigo-900 leading-relaxed">{patient.plan.summary}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[11px] font-bold text-indigo-700">
                    {patient.checkedItems.size}/{patient.plan.plan.length} done
                  </span>
                  {patient.checkedItems.size === patient.plan.plan.length && patient.plan.plan.length > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">All complete ✓</span>
                  )}
                </div>
              </div>

              {/* Timeline */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Time-Structured Interventions</span>
                </div>
                {patient.plan.plan.map((item, index) => {
                  const isDone = patient.checkedItems.has(index);
                  const isPast = shiftStart && item.time < currentTime && item.time >= shiftStart;
                  return (
                    <div
                      key={index}
                      onClick={() => toggleItem(index)}
                      className={`flex gap-3 px-4 py-3.5 cursor-pointer transition-colors border-b border-slate-50 last:border-0 ${
                        isDone ? "bg-teal-50/60" : isPast && !isDone ? "bg-red-50/30" : "hover:bg-slate-50/50"
                      }`}
                    >
                      <div className="flex-shrink-0 w-12 text-center">
                        <p className={`text-xs font-bold font-mono ${isDone ? "text-teal-600" : "text-slate-600"}`}>{item.time}</p>
                        <div className={`w-4 h-4 rounded border mx-auto mt-1 flex items-center justify-center transition-all ${
                          isDone ? "bg-teal-500 border-teal-500" : "border-slate-300"
                        }`}>
                          {isDone && <Check size={9} className="text-white" strokeWidth={3} />}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${PRIORITY_STYLES[item.priority]}`}>
                            {item.priority}
                          </span>
                          <span className={`flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider ${CATEGORY_STYLES[item.category] || "bg-slate-100 text-slate-600"}`}>
                            {CATEGORY_ICONS[item.category]}
                            {item.category}
                          </span>
                          {isPast && !isDone && (
                            <span className="text-[9px] font-bold text-red-600 uppercase tracking-wider">OVERDUE</span>
                          )}
                        </div>
                        <p className={`text-xs leading-relaxed ${isDone ? "line-through text-slate-400" : "text-slate-800"}`}>
                          {item.intervention}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{item.rationale}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Prognosis Trend */}
              {patient.plan.prognosisTrend && (
                <div className={`rounded-xl border px-4 py-3 flex items-center gap-2 ${
                  patient.plan.prognosisTrend === "IMPROVING" ? "border-green-200 bg-green-50" :
                  patient.plan.prognosisTrend === "DETERIORATING" ? "border-red-200 bg-red-50" :
                  patient.plan.prognosisTrend === "STATIC" ? "border-amber-200 bg-amber-50" :
                  "border-slate-200 bg-slate-50"
                }`}>
                  <span className="text-lg">
                    {patient.plan.prognosisTrend === "IMPROVING" ? "📈" :
                     patient.plan.prognosisTrend === "DETERIORATING" ? "📉" :
                     patient.plan.prognosisTrend === "STATIC" ? "➡️" : "❓"}
                  </span>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider">Prognosis Trend: {patient.plan.prognosisTrend}</span>
                    {patient.plan.clinicalTimeline && (
                      <p className="text-xs text-slate-600 mt-0.5">{patient.plan.clinicalTimeline}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Data Prompts — gentle requests for missing data */}
              {patient.plan.dataPrompts && patient.plan.dataPrompts.length > 0 && (
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3.5 space-y-2">
                  <span className="text-xs font-bold text-sky-800 uppercase tracking-wider">💬 Handova Needs a Few Things</span>
                  <p className="text-[10px] text-sky-700">These are optional — but having them will make this plan sharper:</p>
                  {patient.plan.dataPrompts.map((dp, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 mt-0.5 ${
                        dp.priority === "HIGH" ? "bg-orange-100 text-orange-700" : "bg-sky-100 text-sky-700"
                      }`}>{dp.priority}</span>
                      <div>
                        <p className="text-xs text-sky-900 font-medium">{dp.question}</p>
                        <p className="text-[10px] text-sky-600 mt-0.5">{dp.clinicalReason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Nursing Priorities */}
              {patient.plan.nursePriorities && patient.plan.nursePriorities.length > 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">🎯 Nursing Priorities This Shift</span>
                  </div>
                  {patient.plan.nursePriorities.map((p, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-xs font-bold text-blue-700 min-w-[16px]">{p.rank}.</span>
                      <div>
                        <p className="text-xs font-semibold text-blue-900">{p.priority}</p>
                        <p className="text-[11px] text-blue-700">{p.rationale}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Drug Safety Flags */}
              {patient.plan.drugSafetyFlags && patient.plan.drugSafetyFlags.length > 0 && (
                <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3.5 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-orange-800 uppercase tracking-wider">⚠ Drug Safety — AI Generated · Verify Clinically</span>
                  </div>
                  {patient.plan.drugSafetyFlags.map((flag, i) => (
                    <div key={i} className="border-l-2 border-orange-400 pl-3">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                          flag.type === "DRUG_DRUG" ? "bg-red-100 text-red-700" :
                          flag.type === "DRUG_DISEASE" ? "bg-orange-100 text-orange-700" :
                          "bg-yellow-100 text-yellow-700"
                        }`}>
                          {flag.type === "DRUG_DRUG" ? "Drug Interaction" :
                           flag.type === "DRUG_DISEASE" ? "Contraindication" : "Missing Drug"}
                        </span>
                      </div>
                      <p className="text-xs text-orange-900 font-medium">{flag.flag}</p>
                      <p className="text-[11px] text-orange-700 mt-0.5">→ {flag.nursingAction}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Escalation triggers */}
              {patient.plan.escalationTriggers?.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={13} className="text-red-600" />
                    <span className="text-xs font-bold text-red-800 uppercase tracking-wider">Escalation Triggers</span>
                  </div>
                  {patient.plan.escalationTriggers.map((t, i) => (
                    <p key={i} className="text-xs text-red-800 leading-relaxed">• {t}</p>
                  ))}
                </div>
              )}

              {/* End of shift note */}
              {patient.plan.endOfShiftNote && (
                <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-teal-700 uppercase tracking-wider">End-of-Shift Note</span>
                    <button onClick={copyNote}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-teal-200 text-teal-700 hover:bg-teal-50 transition-colors">
                      {noteCopied ? <Check size={10} /> : <Copy size={10} />}
                      {noteCopied ? "Copied" : "Copy & use in report"}
                    </button>
                  </div>
                  <p className="text-xs text-teal-900 leading-relaxed">{patient.plan.endOfShiftNote}</p>
                </div>
              )}

              {/* Think for yourself */}
              {patient.plan.nurseThinkingPrompt && (
                <div className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3.5 space-y-2">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">🧠 Your Clinical Judgment</span>
                  <p className="text-xs text-slate-600 italic">{patient.plan.nurseThinkingPrompt}</p>
                  <textarea
                    rows={3}
                    placeholder="Add what the AI missed — observations, concerns, or changes to this plan..."
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 resize-none focus:outline-none focus:ring-1 focus:ring-teal-400 placeholder:text-slate-400"
                  />
                </div>
              )}

              {/* Update History Timeline */}
              {patient.updateHistory && patient.updateHistory.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 space-y-3">
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">📋 Shift Update History</span>
                  {patient.updateHistory.map((u, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] font-bold text-indigo-600 whitespace-nowrap">{u.time}</span>
                        {i < patient.updateHistory.length - 1 && (
                          <div className="w-px flex-1 bg-slate-200 mt-1" />
                        )}
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed pb-2">{u.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Mid-shift Update Panel */}
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-800 uppercase tracking-wider">🔄 Mid-Shift Update</span>
                  <button
                    onClick={() => setShowUpdateInput(p => !p)}
                    className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    {showUpdateInput ? "Cancel" : "+ Add Update"}
                  </button>
                </div>

                {showUpdateInput && (
                  <div className="space-y-2">
                    <p className="text-[10px] text-indigo-700">
                      What has changed? New vitals, complaints, doctor instructions, anything — Handova will revise the full plan.
                    </p>
                    <div className="relative">
                      <textarea
                        value={midShiftUpdate}
                        onChange={e => setMidShiftUpdate(e.target.value)}
                        rows={4}
                        placeholder="e.g. BP now 90/60, patient complaining of chest pain, doctor asked for ECG..."
                        className="w-full text-xs border border-indigo-200 rounded-xl px-3 py-2.5 bg-white text-slate-800 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 placeholder:text-slate-400 leading-relaxed pr-10"
                      />
                      <button
                        onClick={() => updateVoice.listening ? updateVoice.stop() : updateVoice.start(midShiftUpdate)}
                        className={`absolute right-2 top-2 p-1.5 rounded-lg transition-colors ${
                          updateVoice.listening ? "bg-red-100 text-red-600" : "bg-indigo-100 text-indigo-600 hover:bg-indigo-200"
                        }`}
                      >
                        {updateVoice.transcribing ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <span className="text-[10px]">{updateVoice.listening ? "⏹" : "🎤"}</span>
                        )}
                      </button>
                    </div>

                    {patient.isUpdatingPlan && (
                      <div className="flex items-center gap-2 py-2">
                        <Loader2 size={13} className="text-indigo-500 animate-spin" />
                        <p className="text-xs text-indigo-700 font-medium">Revising care plan…</p>
                      </div>
                    )}

                    {patient.updateError && (
                      <div className={`rounded-lg px-3 py-2 text-xs font-medium ${
                        patient.updateError.startsWith("🚨")
                          ? "bg-red-100 border border-red-300 text-red-800"
                          : "bg-red-50 border border-red-200 text-red-700"
                      }`}>
                        {patient.updateError}
                      </div>
                    )}

                    <button
                      onClick={() => {
                        if (!midShiftUpdate.trim() || patient.isUpdatingPlan) return;
                        onUpdatePlan(patient.id, midShiftUpdate.trim());
                        setMidShiftUpdate("");
                        setShowUpdateInput(false);
                      }}
                      disabled={!midShiftUpdate.trim() || patient.isUpdatingPlan}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold transition-colors"
                    >
                      {patient.isUpdatingPlan ? "Revising plan…" : "Revise Full Plan"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
