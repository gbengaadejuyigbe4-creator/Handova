/**
 * storage.ts — Handova v10.5.1
 *
 * localStorage persistence for Handova.
 * - Draft: auto-saved shift in progress
 * - Report history: completed shift reports (max 20)
 * - Planner history: completed shift care plans (max 20)
 * - Custom wards
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import type { ShiftHeader, Patient } from "../types";

const KEYS = {
  DRAFT: "handova_draft",
  HISTORY: "handova_history",
  PLANNER_HISTORY: "handova_planner_history",
  CUSTOM_WARDS: "handova_custom_wards",
} as const;

const MAX_HISTORY = 20;

// ─── DRAFT ───────────────────────────────────────────────────────────────────

export interface DraftState {
  header: ShiftHeader;
  patients: Patient[];
  savedAt: string;
}

export function saveDraft(header: ShiftHeader, patients: Patient[]): void {
  try {
    localStorage.setItem(KEYS.DRAFT, JSON.stringify({ header, patients, savedAt: new Date().toISOString() }));
  } catch {}
}

export function loadDraft(): DraftState | null {
  try {
    const raw = localStorage.getItem(KEYS.DRAFT);
    return raw ? JSON.parse(raw) as DraftState : null;
  } catch { return null; }
}

export function clearDraft(): void {
  try { localStorage.removeItem(KEYS.DRAFT); } catch {}
}

export function hasDraft(): boolean {
  try { return Boolean(localStorage.getItem(KEYS.DRAFT)); } catch { return false; }
}

// ─── REPORT HISTORY ──────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  ward: string;
  shift: string;
  date: string;
  patientCount: number;
  savedAt: string;
  report: string;
  header: ShiftHeader;
  patients: Patient[];
}

export function saveToHistory(header: ShiftHeader, patients: Patient[], report: string): void {
  try {
    const history = loadHistory();
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      ward: header.ward,
      shift: header.shift,
      date: header.date,
      patientCount: patients.length,
      savedAt: new Date().toISOString(),
      report,
      header,
      patients,
    };
    localStorage.setItem(KEYS.HISTORY, JSON.stringify([entry, ...history].slice(0, MAX_HISTORY)));
  } catch {}
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEYS.HISTORY);
    return raw ? JSON.parse(raw) as HistoryEntry[] : [];
  } catch { return []; }
}

export function deleteHistoryEntry(id: string): void {
  try {
    localStorage.setItem(KEYS.HISTORY, JSON.stringify(loadHistory().filter(e => e.id !== id)));
  } catch {}
}

// ─── PLANNER HISTORY ─────────────────────────────────────────────────────────

export interface PlannerHistoryEntry {
  id: string;
  patientName: string;
  diagnosis: string;
  shiftStart: string;
  shiftEnd: string;
  ward: string;
  savedAt: string;
  plan: {
    summary: string;
    plan: Array<{
      time: string;
      priority: string;
      category: string;
      intervention: string;
      rationale: string;
    }>;
    escalationTriggers: string[];
    endOfShiftNote: string;
  };
}

export function savePlannerEntry(entry: Omit<PlannerHistoryEntry, "id" | "savedAt">): void {
  try {
    const history = loadPlannerHistory();
    const full: PlannerHistoryEntry = {
      ...entry,
      id: Date.now().toString(),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(KEYS.PLANNER_HISTORY, JSON.stringify([full, ...history].slice(0, MAX_HISTORY)));
  } catch {}
}

export function loadPlannerHistory(): PlannerHistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEYS.PLANNER_HISTORY);
    return raw ? JSON.parse(raw) as PlannerHistoryEntry[] : [];
  } catch { return []; }
}

export function deletePlannerEntry(id: string): void {
  try {
    localStorage.setItem(KEYS.PLANNER_HISTORY, JSON.stringify(loadPlannerHistory().filter(e => e.id !== id)));
  } catch {}
}

// ─── CUSTOM WARDS ────────────────────────────────────────────────────────────

export function loadCustomWards(): string[] {
  try {
    const raw = localStorage.getItem(KEYS.CUSTOM_WARDS);
    return raw ? JSON.parse(raw) as string[] : [];
  } catch { return []; }
}

export function saveCustomWard(ward: string): void {
  try {
    const trimmed = ward.trim();
    if (!trimmed) return;
    const existing = loadCustomWards();
    if (existing.some(w => w.toLowerCase() === trimmed.toLowerCase())) return;
    localStorage.setItem(KEYS.CUSTOM_WARDS, JSON.stringify([trimmed, ...existing]));
  } catch {}
}

export function deleteCustomWard(ward: string): void {
  try {
    localStorage.setItem(KEYS.CUSTOM_WARDS, JSON.stringify(loadCustomWards().filter(w => w !== ward)));
  } catch {}
}
