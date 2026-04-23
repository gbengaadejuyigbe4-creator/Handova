/**
 * useShiftReport
 *
 * Manages the top-level shift report state — the header and patient list.
 * Uses a ref-based approach for patient data to prevent unnecessary
 * re-renders of sibling patient forms when one patient's state changes.
 *
 * Added loadFromDraft — restores a saved draft including patient data.
 */

import { useState, useCallback, useRef } from "react";
import type { Patient, ShiftHeader } from "../types";
import { EMPTY_SHIFT_HEADER, EMPTY_VITALS, DEFAULT_CONDITION } from "../utils/clinicalConstants";

export function useShiftReport() {
  const counterRef = useRef(1);

  const [header, setHeader] = useState<ShiftHeader>({ ...EMPTY_SHIFT_HEADER });
  const [patientIds, setPatientIds] = useState<number[]>(() => [counterRef.current++]);
  const patientDataRef = useRef<Record<number, Partial<Patient>>>({});

  const updatePatient = useCallback((id: number, data: Partial<Patient>) => {
    patientDataRef.current[id] = data;
  }, []);

  const removePatient = useCallback((id: number) => {
    delete patientDataRef.current[id];
    setPatientIds(prev => prev.filter(p => p !== id));
  }, []);

  const addPatient = useCallback(() => {
    const id = counterRef.current++;
    setPatientIds(prev => [...prev, id]);
  }, []);

  const getPatients = useCallback((): Patient[] => {
    return patientIds.map(id => ({
      id,
      name: "",
      age: "",
      gender: "" as const,
      ward: "",
      bedNumber: "",
      admissionDate: "",
      dischargeDate: "",
      initialDiagnosis: "",
      currentDiagnosis: "",
      investigation: "",
      arrivalType: "" as const,
      arrivalFrom: "",
      arrivalOther: "",
      doctorsPlan: "",
      nursesNoteRaw: "",
      emrClinicalText: "",
      shiftQuestions: [],
      questionsLoading: false,
      nursesNoteGenerated: "",
      fluid: "",
      medsAdministered: "",
      vitals: { ...EMPTY_VITALS },
      conditionAtReport: DEFAULT_CONDITION,
      isGenerating: false,
      noteReady: false,
      ...(patientDataRef.current[id] || {}),
    }));
  }, [patientIds]);

  const resetReport = useCallback(() => {
    setHeader({ ...EMPTY_SHIFT_HEADER });
    patientDataRef.current = {};
    setPatientIds([counterRef.current++]);
  }, []);

  /**
   * Restores a saved draft — replaces current header and patient list.
   * Patient form components re-mount with their draft data pre-populated
   * via patientDataRef, which usePatientForm reads on initialisation.
   */
  const loadFromDraft = useCallback((draftHeader: ShiftHeader, draftPatients: Patient[]) => {
    setHeader(draftHeader);
    patientDataRef.current = {};
    const ids: number[] = [];
    for (const p of draftPatients) {
      const id = counterRef.current++;
      ids.push(id);
      patientDataRef.current[id] = p;
    }
    setPatientIds(ids.length > 0 ? ids : [counterRef.current++]);
  }, []);

  const getPatientInitialData = useCallback((id: number): Partial<Patient> | undefined => {
    return patientDataRef.current[id];
  }, []);

  return {
    header,
    setHeader,
    patientIds,
    updatePatient,
    removePatient,
    addPatient,
    getPatients,
    resetReport,
    loadFromDraft,
    getPatientInitialData,
  };
}
