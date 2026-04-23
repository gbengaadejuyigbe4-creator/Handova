/**
 * settings.ts — User settings persistence for Handova
 * v10.5: Added shiftStartTime, shiftEndTime for Shift Planner
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import type { Language } from "./i18n";
import type { Region } from "./regionConfig";

export interface AppSettings {
  nurseName: string;
  nurseCredentials: string;
  facilityName: string;
  defaultWard: string;
  defaultShift: string;
  defaultFormat: "standard" | "sbar" | "isbar" | "soap";
  language: Language;
  region: Region;
  shiftStartTime: string; // HH:MM e.g. "08:00"
  shiftEndTime: string;   // HH:MM e.g. "20:00"
}

const KEY = "handova_settings";

export const DEFAULT_SETTINGS: AppSettings = {
  nurseName: "",
  nurseCredentials: "",
  facilityName: "",
  defaultWard: "",
  defaultShift: "",
  defaultFormat: "standard",
  language: "en",
  region: "ng",
  shiftStartTime: "",
  shiftEndTime: "",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}
