/**
 * usePatientForm
 *
 * Manages all state for a single patient form.
 * Separates state logic from UI rendering.
 *
 * v10.5.1: shiftQuestions state, draft sync, EMR integration.
 * Questions are generated automatically after EMR upload and
 * injected into the AI generation prompt as primary shift evidence.
 */

import { useState, useCallback } from "react";
import type { Patient, VitalSigns, ArrivalType, Gender, ShiftQuestion } from "../types";
import { EMPTY_VITALS, DEFAULT_CONDITION } from "../utils/clinicalConstants";
import { generateNursesNote } from "../utils/claudeApi";
import type { ShiftHeader } from "../types";
import type { AppSettings } from "../utils/settings";

interface ExtractedPatientData {
  name?: string;
  age?: string;
  gender?: string;
  ward?: string;
  bedNumber?: string;
  admissionDate?: string;
  currentDiagnosis?: string;
  initialDiagnosis?: string;
  doctorsPlan?: string;
  investigation?: string;
  fluid?: string;
  medsAdministered?: string;
  vitals?: {
    bp?: string;
    pulse?: string;
    respRate?: string;
    temp?: string;
    spo2?: string;
    rbs?: string;
  };
  pendingLabsNote?: string;
  unreviewedResults?: string[];
  flags?: string[];
  emrClinicalText?: string;
}

interface UsePatientFormProps {
  patientId: number;
  header: ShiftHeader;
  onUpdate: (id: number, data: Partial<Patient>) => void;
  initialData?: Partial<Patient>;
  settings?: AppSettings;
}

export function usePatientForm({ patientId, header, onUpdate, initialData, settings }: UsePatientFormProps) {
  const [data, setData] = useState<Omit<Patient, "id" | "isGenerating" | "noteReady">>({
    name: "",
    age: "",
    gender: "" as Gender,
    ward: "",
    bedNumber: "",
    admissionDate: "",
    dischargeDate: "",
    initialDiagnosis: "",
    currentDiagnosis: "",
    investigation: "",
    arrivalType: "" as ArrivalType,
    arrivalFrom: "",
    arrivalOther: "",
    doctorsPlan: "",
    nursesNoteRaw: "",
    nursesNoteGenerated: "",
    fluid: "",
    medsAdministered: "",
    vitals: { ...EMPTY_VITALS },
    conditionAtReport: DEFAULT_CONDITION,
    shiftQuestions: [],
    questionsLoading: false,
    ...initialData,
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [noteReady, setNoteReady] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [format, setFormat] = useState<"standard" | "sbar" | "isbar" | "soap">(settings?.defaultFormat || "standard");

  const setField = useCallback(<K extends keyof typeof data>(key: K, value: (typeof data)[K]) => {
    setData(prev => {
      const updated = { ...prev, [key]: value };
      onUpdate(patientId, updated);
      return updated;
    });
  }, [onUpdate, patientId]);

  const setVital = useCallback((key: keyof VitalSigns, value: string) => {
    setData(prev => {
      const updated = { ...prev, vitals: { ...prev.vitals, [key]: value } };
      onUpdate(patientId, updated);
      return updated;
    });
  }, [onUpdate, patientId]);

  // ─── SHIFT QUESTIONS ───────────────────────────────────────────────────────

  const setQuestionsLoading = useCallback((loading: boolean) => {
    setData(prev => ({ ...prev, questionsLoading: loading }));
  }, []);

  const setShiftQuestions = useCallback((questions: ShiftQuestion[]) => {
    setData(prev => {
      const updated = { ...prev, shiftQuestions: questions, questionsLoading: false };
      onUpdate(patientId, updated);
      return updated;
    });
  }, [onUpdate, patientId]);

  const updateQuestionAnswer = useCallback((id: number, answer: string) => {
    setData(prev => {
      const updated = {
        ...prev,
        shiftQuestions: prev.shiftQuestions.map(q =>
          q.id === id ? { ...q, answer } : q
        ),
      };
      onUpdate(patientId, updated);
      return updated;
    });
  }, [onUpdate, patientId]);

  const updateQuestionRecording = useCallback((id: number, isRecording: boolean) => {
    setData(prev => ({
      ...prev,
      shiftQuestions: prev.shiftQuestions.map(q =>
        q.id === id ? { ...q, isRecording } : q
      ),
    }));
  }, []);

  // ─── NOTE GENERATION ───────────────────────────────────────────────────────

  const generateNote = useCallback(async () => {
    // Allow generation if:
    // - nurse typed shift events, OR
    // - EMR context is present (⚠️/🚨 tags), OR
    // - at least one shift question has been answered
    const hasEmrContext = data.nursesNoteRaw.includes("⚠️") || data.nursesNoteRaw.includes("🚨");
    const hasEmrText = !!data.emrClinicalText?.trim();
    const hasAnsweredQuestions = (data.shiftQuestions || []).some(q => q.answer.trim().length > 0);

    if (!data.nursesNoteRaw.trim() && !hasEmrContext && !hasEmrText && !hasAnsweredQuestions) {
      setError("Please enter shift events, answer at least one question, or upload the patient's EMR.");
      return;
    }
    if (!data.currentDiagnosis.trim()) {
      setError("Please enter the current diagnosis.");
      return;
    }

    setError("");
    setIsGenerating(true);
    setNoteReady(false);

    const snapshot = data;

    try {
      const note = await generateNursesNote(snapshot as Patient, header, format, settings);
      setData(prev => {
        const updated = { ...prev, nursesNoteGenerated: note };
        onUpdate(patientId, { ...updated, noteReady: true });
        return updated;
      });
      setNoteReady(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Generation failed";
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [data, header, patientId, onUpdate, format, settings]);

  const toggleExpanded = useCallback(() => setExpanded(p => !p), []);

  // ─── EMR DATA APPLICATION ──────────────────────────────────────────────────

  const applyEmrData = useCallback((emr: ExtractedPatientData) => {
    setData(prev => {
      const contextParts: string[] = [];

      if (emr.unreviewedResults && emr.unreviewedResults.length > 0) {
        contextParts.push(`⚠️ UNREVIEWED RESULTS: ${emr.unreviewedResults.join("; ")}`);
      }
      if (emr.pendingLabsNote) {
        contextParts.push(`⚠️ PENDING LABS (not yet reviewed): ${emr.pendingLabsNote}`);
      }
      if (emr.flags && emr.flags.length > 0) {
        contextParts.push(`🚨 CLINICAL FLAGS: ${emr.flags.join("; ")}`);
      }

      const existingNotes = prev.nursesNoteRaw.trim();
      const nursesNoteRaw = [existingNotes, ...contextParts]
        .filter(Boolean)
        .join("\n\n")
        .trim();

      const updated = {
        ...prev,
        ...(emr.emrClinicalText && { emrClinicalText: emr.emrClinicalText }),
        ...(emr.name && { name: emr.name }),
        ...(emr.age && { age: emr.age }),
        ...(emr.gender && { gender: emr.gender as Gender }),
        ...(emr.ward && { ward: emr.ward }),
        ...(emr.bedNumber && { bedNumber: emr.bedNumber }),
        ...(emr.admissionDate && { admissionDate: emr.admissionDate }),
        ...(emr.currentDiagnosis && { currentDiagnosis: emr.currentDiagnosis }),
        ...(emr.initialDiagnosis && { initialDiagnosis: emr.initialDiagnosis }),
        ...(emr.doctorsPlan && { doctorsPlan: emr.doctorsPlan }),
        ...(emr.medsAdministered && { medsAdministered: emr.medsAdministered }),
        vitals: {
          ...prev.vitals,
          ...(emr.vitals?.bp && { bp: emr.vitals.bp }),
          ...(emr.vitals?.pulse && { pulse: emr.vitals.pulse }),
          ...(emr.vitals?.respRate && { respRate: emr.vitals.respRate }),
          ...(emr.vitals?.temp && { temp: emr.vitals.temp }),
          ...(emr.vitals?.spo2 && { spo2: emr.vitals.spo2 }),
          ...(emr.vitals?.rbs && { rbs: emr.vitals.rbs }),
        },
        nursesNoteRaw,
      };
      onUpdate(patientId, updated);
      return updated;
    });
    setExpanded(true);
  }, [onUpdate, patientId]);

  return {
    data,
    setField,
    setVital,
    isGenerating,
    noteReady,
    error,
    expanded,
    toggleExpanded,
    generateNote,
    format,
    setFormat,
    applyEmrData,
    // Shift questions
    setShiftQuestions,
    setQuestionsLoading,
    updateQuestionAnswer,
    updateQuestionRecording,
  };
}
