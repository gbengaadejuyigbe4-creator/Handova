/**
 * App.tsx — Handova v11.1
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useState, useEffect, useRef } from "react";
import { Plus, FileText, ChevronRight, Settings, Info, ClipboardList, History, Moon, Sun } from "lucide-react";
import ShiftHeader from "./components/ShiftHeader";
import PatientForm from "./components/PatientForm";
import ReportOutput from "./components/ReportOutput";
import LandingPage from "./components/LandingPage";
import Onboarding, { shouldShowOnboarding } from "./components/Onboarding";
import SettingsPanel from "./components/SettingsPanel";
import AboutPanel from "./components/AboutPanel";
import QuickMode from "./components/QuickMode";
import ShiftPlanner from "./components/ShiftPlanner";
import RecordsPage from "./components/RecordsPage";
import { useShiftReport } from "./hooks/useShiftReport";
import { saveDraft, loadDraft, clearDraft, hasDraft, saveToHistory } from "./utils/storage";
import { buildFullReport } from "./utils/reportFormatter";
import { loadSettings, AppSettings } from "./utils/settings";
import { t, getDir, Language } from "./utils/i18n";
import type { Patient } from "./types";

const STEPS_KEYS = ["step1", "step2", "step3"] as const;

export default function App() {
  const [showLanding, setShowLanding] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [step, setStep] = useState(0);
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [appMode, setAppMode] = useState<"quick" | "structured">("structured");
  const [appPage, setAppPage] = useState<"report" | "planner" | "records">("report");
  const [isDarkMode, setIsDarkMode] = useState(false);
  const historySavedRef = useRef(false);

  // Initialize Dark Mode based on preference / local storage
  useEffect(() => {
    const saved = localStorage.getItem("handova_theme");
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setIsDarkMode(true);
      document.documentElement.classList.add("dark");
    } else {
      setIsDarkMode(false);
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode(prev => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
        localStorage.setItem("handova_theme", "dark");
      } else {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("handova_theme", "light");
      }
      return next;
    });
  };

  const lang: Language = settings.language || "en";
  const dir = getDir(lang);

  const {
    header, setHeader, patientIds, updatePatient, removePatient,
    addPatient, getPatients, resetReport, loadFromDraft, getPatientInitialData,
  } = useShiftReport();

  useEffect(() => {
    if (hasDraft()) setShowDraftBanner(true);
  }, []);

  // Apply RTL direction to document
  useEffect(() => {
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", lang);
  }, [lang, dir]);

  const handleRestoreDraft = () => {
    const draft = loadDraft();
    if (!draft) return;
    loadFromDraft(draft.header, draft.patients);
    setShowDraftBanner(false);
    setShowLanding(false);
  };

  const handleDiscardDraft = () => {
    clearDraft();
    setShowDraftBanner(false);
  };

  const handleEnterApp = () => {
    setShowLanding(false);
    if (shouldShowOnboarding()) setShowOnboarding(true);
    // Apply defaults from settings
    setHeader(prev => ({
      ...prev,
      ...(settings.defaultShift && !prev.shift ? { shift: settings.defaultShift as never } : {}),
    }));
  };

  const handleSettingsChange = (newSettings: AppSettings) => {
    setSettings(newSettings);
    // Apply new default shift immediately to the current header if not already set
    if (newSettings.defaultShift) {
      setHeader(prev => ({
        ...prev,
        shift: prev.shift || newSettings.defaultShift as never,
      }));
    }
  };

  const canProceed0 = Boolean(header.ward && header.shift && header.date);
  const patients = getPatients() as Patient[];

  useEffect(() => {
    if (showLanding) return;
    saveDraft(header, patients);
  });

  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [autoGenerateProgress, setAutoGenerateProgress] = useState({ current: 0, total: 0 });

  const handleGoToReport = async () => {
    // Find patients that have raw notes or diagnosis but no generated note yet
    const needsGeneration = patients.filter(
      p => !p.nursesNoteGenerated?.trim() && (p.nursesNoteRaw?.trim() || p.currentDiagnosis?.trim())
    );

    if (needsGeneration.length > 0) {
      setIsAutoGenerating(true);
      setAutoGenerateProgress({ current: 0, total: needsGeneration.length });

      for (let i = 0; i < needsGeneration.length; i++) {
        const p = needsGeneration[i];
        setAutoGenerateProgress({ current: i + 1, total: needsGeneration.length });
        try {
          const { generateNursesNote } = await import("./utils/claudeApi");
          const note = await generateNursesNote(p, header, (settings?.defaultFormat as "standard" | "sbar" | "isbar" | "soap") || "standard", settings);
          updatePatient(p.id, { nursesNoteGenerated: note, noteReady: true });
        } catch {
          // If generation fails for one patient, continue with others
          // The report will fall back to nursesNoteRaw for that patient
        }
      }
      setIsAutoGenerating(false);
    }

    setStep(2);

    // FIX: Use getPatients() here — NOT the stale `patients` closure variable.
    // `patients` was captured before updatePatient() calls resolved so it still
    // has empty nursesNoteGenerated fields. getPatients() reads fresh ref state.
    if (!historySavedRef.current) {
      const freshPatients = getPatients() as Patient[];
      const report = buildFullReport(header, freshPatients, settings);
      saveToHistory(header, freshPatients, report);
      historySavedRef.current = true;
    }
  };

  const handleReset = () => {
    resetReport();
    clearDraft();
    historySavedRef.current = false;
    setStep(0);
  };

  const getPatientInitialDataWithDefaults = (id: number) => {
    const base = getPatientInitialData(id) || {};
    return {
      // Apply defaults first, then overlay any explicitly saved patient data
      // Only apply default if the base value is empty (not explicitly set)
      ward: base.ward || settings.defaultWard || "",
      ...base,
      // Re-apply ward after spread so empty string from base doesn't override default
      ...((!base.ward && settings.defaultWard) ? { ward: settings.defaultWard } : {}),
    };
  };

  if (showLanding) {
    return (
      <>
        {showDraftBanner && (
          <div className="fixed top-0 left-0 right-0 z-[300] flex justify-center px-4 pt-4">
            <div className="glass border border-teal-500/30 rounded-2xl px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 max-w-lg w-full shadow-2xl fade-up">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">{t(lang, "continueDraft")}</p>
                <p className="text-xs text-slate-400 mt-0.5">{t(lang, "draftFound")}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={handleDiscardDraft} className="btn-secondary text-xs px-3 py-2">{t(lang, "discard")}</button>
                <button onClick={handleRestoreDraft} className="btn-primary text-xs px-3 py-2">{t(lang, "restore")}</button>
              </div>
            </div>
          </div>
        )}
        <LandingPage onEnterApp={handleEnterApp} />
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onSettingsChange={handleSettingsChange} lang={lang} />}
        {showAbout && <AboutPanel onClose={() => setShowAbout(false)} lang={lang} />}
      </>
    );
  }

  return (
    <div className="min-h-screen mesh-bg" dir={dir}>
      {showOnboarding && <Onboarding onComplete={() => setShowOnboarding(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onSettingsChange={handleSettingsChange} lang={lang} />}
      {showAbout && <AboutPanel onClose={() => setShowAbout(false)} lang={lang} />}

      {/* Floating Modern Nav Dock */}
      <div className="fixed top-4 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
        <nav className="pointer-events-auto bg-white/70 dark:bg-[#111827]/70 backdrop-blur-xl border border-slate-200/50 dark:border-white/10 rounded-full shadow-lg shadow-teal-900/5 transition-all w-full max-w-4xl px-4 py-2 flex items-center justify-between">
          <button onClick={() => setShowLanding(true)} className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-xl overflow-hidden">
              <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <rect width="48" height="48" rx="12" fill="#0D9488"/>
                <path d="M13 12h5v10h12V12h5v24h-5V27H18v9h-5V12z" fill="white" opacity="0.95"/>
              </svg>
            </div>
            <span className="font-display font-semibold text-teal-700 text-lg group-hover:text-teal-600 transition-colors">Handova</span>
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowAbout(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            >
              <Info size={14} />
              <span className="hidden sm:inline">{t(lang, "about")}</span>
            </button>
            <button
              onClick={() => setAppPage("records")}
              className={"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors " + (appPage === "records" ? "text-slate-800 bg-slate-100" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100")}
            >
              <History size={14} />
              <span className="hidden sm:inline">Records</span>
            </button>
            <button
              onClick={() => setAppPage("planner")}
              className={"flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors " + (appPage === "planner" ? "text-indigo-700 bg-indigo-50" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100")}
            >
              <ClipboardList size={14} />
              <span className="hidden sm:inline">Planner</span>
            </button>
            <button
              onClick={toggleDarkMode}
              className="flex items-center justify-center w-8 h-8 rounded-full text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center w-8 h-8 rounded-full text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Settings size={15} />
            </button>
          </div>
        </nav>
      </div>

      {/* Spacer to push content down below fixed nav */}
      <div className="h-24"></div>

      {/* Step bar — only on report page */}
      {appPage === "report" && (
        <div className="max-w-4xl mx-auto px-4 pb-4 flex items-center gap-2 justify-center sm:justify-start">
            {STEPS_KEYS.map((key, i) => (
              <button key={key} id={`step-${i}`}
                onClick={() => { if (i===0) setStep(0); if (i===1&&canProceed0) setStep(1); if (i===2) handleGoToReport(); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 ${step===i?"step-pill-active":step>i?"step-pill-done":"step-pill-todo"}`}>
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${step>i?"bg-teal-600 text-white":step===i?"bg-teal-500 text-white":"bg-slate-200 text-slate-500"}`}>
                  {step > i ? "✓" : i + 1}
                </span>
                {t(lang, key)}
                {i < STEPS_KEYS.length - 1 && <ChevronRight size={10} className="text-slate-400 ml-0.5" />}
              </button>
            ))}
          </div>
        )}
        {appPage === "planner" && (
          <div className="max-w-4xl mx-auto px-4 pb-3">
            <button onClick={() => setAppPage("report")} className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors">
              ← Back to Shift Report
            </button>
          </div>
        )}
        {appPage === "records" && (
          <div className="max-w-4xl mx-auto px-4 pb-3">
            <button onClick={() => setAppPage("report")} className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors">
              ← Back to Shift Report
            </button>
          </div>
        )}
     

      <main className="max-w-4xl mx-auto px-4 py-8">

        {/* Records page */}
        {appPage === "records" && (
          <RecordsPage />
        )}

        {/* Shift Planner page */}
        {appPage === "planner" && (
          <ShiftPlanner settings={settings} />
        )}

        {appPage === "report" && step === 0 && (
          <div className="space-y-6">
            {/* Mode selector */}
            <div className="fade-up">
              <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1 mb-6">
                <button
                  onClick={() => setAppMode("quick")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    appMode === "quick"
                      ? "bg-white text-teal-700 shadow-sm border border-slate-200"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  ⚡ Quick Mode
                </button>
                <button
                  onClick={() => setAppMode("structured")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    appMode === "structured"
                      ? "bg-white text-teal-700 shadow-sm border border-slate-200"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  ✍️ Structured Mode
                </button>
              </div>
            </div>

            {/* Quick Mode */}
            {appMode === "quick" && (
              <QuickMode
                settings={settings}
                onSwitchToStructured={() => setAppMode("structured")}
              />
            )}

            {/* Structured Mode — existing step flow */}
            {appMode === "structured" && (
              <>
                <div className="fade-up">
                  <p className="section-label mb-2">{t(lang, "stepLabel", 1, 3)}</p>
                  <h1 className="font-display text-3xl font-semibold text-slate-900 mb-1">{t(lang, "shiftInformation")}</h1>
                  <p className="text-sm text-slate-500">{t(lang, "shiftInformationDesc")}</p>
                </div>
                <ShiftHeader header={header} onChange={setHeader} />
                <div className="flex justify-end pt-2">
                  <button onClick={() => setStep(1)} disabled={!canProceed0} className="btn-primary">
                    {t(lang, "continueToPatients")} <ChevronRight size={15} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {appPage === "report" && step === 1 && (
          <div className="space-y-6">
            <div className="fade-up flex items-start justify-between">
              <div>
                <p className="section-label mb-2">{t(lang, "stepLabel", 2, 3)}</p>
                <h1 className="font-display text-3xl font-semibold text-slate-900 mb-1">{t(lang, "patients")}</h1>
                <p className="text-sm text-slate-500">{t(lang, "patientsDesc")}</p>
              </div>
              <span className="text-xs text-slate-500 glass-light px-3 py-1.5 rounded-full mt-1">
                {patientIds.length} {t(lang, "patients").toLowerCase()}
              </span>
            </div>
            <div className="space-y-4">
              {patientIds.map((id, i) => (
                <PatientForm
                  key={id}
                  patientId={id}
                  index={i}
                  header={header}
                  onUpdate={updatePatient}
                  onRemove={removePatient}
                  initialData={getPatientInitialDataWithDefaults(id)}
                  lang={lang}
                  defaultFormat={settings.defaultFormat}
                  settings={settings}
                />
              ))}
            </div>
            <button onClick={addPatient}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-slate-300 hover:border-teal-400 text-slate-500 hover:text-teal-600 py-3.5 rounded-xl text-sm transition-all duration-200">
              <Plus size={15} /> {t(lang, "addPatient")}
            </button>
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(0)} className="btn-secondary text-sm">{t(lang, "back")}</button>
              <button onClick={handleGoToReport} disabled={isAutoGenerating} className="btn-primary text-sm">
                {isAutoGenerating ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Generating {autoGenerateProgress.current}/{autoGenerateProgress.total}…
                  </>
                ) : (
                  <><FileText size={14} /> {t(lang, "viewFullReport")}</>
                )}
              </button>
            </div>
          </div>
        )}

        {appPage === "report" && step === 2 && (
          <div className="space-y-6">
            <div className="fade-up">
              <p className="section-label mb-2">{t(lang, "stepLabel", 3, 3)}</p>
              <h1 className="font-display text-3xl font-semibold text-slate-900 mb-1">{t(lang, "fullReport")}</h1>
              <p className="text-sm text-slate-500">{t(lang, "fullReportDesc")}</p>
            </div>
            <ReportOutput header={header} patients={patients} lang={lang} settings={settings} />
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(1)} className="btn-secondary text-sm">{t(lang, "backToPatients")}</button>
              <button onClick={handleReset} className="text-xs text-slate-500 hover:text-slate-700 transition-colors py-2">
                {t(lang, "startNewReport")}
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="text-center py-6 text-xs text-slate-400 border-t border-slate-200 mt-12">
        Handova v11.1 · AI-Powered Nursing Shift Reports · © 2026
      </footer>
    </div>
  );
}
