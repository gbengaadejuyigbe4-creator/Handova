/**
 * App.tsx — Handova v11.1
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useState, useEffect, useRef } from "react";
import { Plus, FileText, ChevronRight, Settings, Info, Moon, Sun, ListChecks, Zap } from "lucide-react";
import Logo from "./components/Logo";
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
import HomeScreen from "./components/HomeScreen";
import AppNav from "./components/AppNav";
import { useRoute } from "./hooks/useRoute";
import { useShiftReport } from "./hooks/useShiftReport";
import { saveDraft, loadDraft, clearDraft, hasDraft, saveToHistory } from "./utils/storage";
import { buildFullReport } from "./utils/reportFormatter";
import { loadSettings, AppSettings } from "./utils/settings";
import { t, getDir, Language } from "./utils/i18n";
import type { Patient } from "./types";

const STEPS_KEYS = ["step1", "step2", "step3"] as const;

export default function App() {
  // The screen comes from the URL hash (#/home, #/planner, #/report, #/records).
  // No app route in the hash means the landing page.
  const { route, navigate } = useRoute();
  const showLanding = route === null;
  const appPage = route ?? "home";
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [step, setStep] = useState(0);
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [appMode, setAppMode] = useState<"quick" | "structured">("structured");
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

  // Opening or refreshing straight onto an app screen skips the landing page, where the
  // draft banner lives. Read the draft once, before anything can overwrite it, and restore it
  // so a refresh never loses a report in progress.
  const [initialDraft] = useState(() => (route !== null ? loadDraft() : null));
  useEffect(() => {
    if (initialDraft) loadFromDraft(initialDraft.header, initialDraft.patients);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each screen gets its own title, and a new screen starts at the top.
  const baseTitle = useRef(document.title);
  useEffect(() => {
    const names = { home: "Home", planner: "Shift planner", report: "Handover report", records: "Records" } as const;
    document.title = route ? `${names[route]} · Handova` : baseTitle.current;
    if (route !== null) window.scrollTo(0, 0);
  }, [route]);

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
    navigate("report");
  };

  const handleDiscardDraft = () => {
    clearDraft();
    setShowDraftBanner(false);
  };

  // Runs when the person arrives on any app screen, whether from the landing page,
  // a bookmark or a refresh.
  useEffect(() => {
    if (showLanding) return;
    if (shouldShowOnboarding()) setShowOnboarding(true);
    // Apply defaults from settings
    setHeader(prev => ({
      ...prev,
      ...(settings.defaultShift && !prev.shift ? { shift: settings.defaultShift as never } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLanding]);

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
            <div className="bg-[var(--surface-1)] border border-[var(--border-strong)] rounded-lg px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 max-w-lg w-full shadow-lg fade-up">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[var(--text-primary)]">{t(lang, "continueDraft")}</p>
                <p className="text-sm text-slate-600 mt-0.5">{t(lang, "draftFound")}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={handleDiscardDraft} className="btn-secondary text-xs px-3 py-2">{t(lang, "discard")}</button>
                <button onClick={handleRestoreDraft} className="btn-primary text-xs px-3 py-2">{t(lang, "restore")}</button>
              </div>
            </div>
          </div>
        )}
        <LandingPage onOpen={navigate} />
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

      {/* Top bar: flat, full width, separated from the page by a rule */}
      <header className="sticky top-0 z-50 bg-[var(--surface-1)] border-b border-[var(--border-strong)]">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          <button onClick={() => navigate("home")} className="flex items-center gap-2 flex-shrink-0" aria-label="Handova home">
            <Logo size={28} />
            <span className="font-display text-[18px] text-teal-700 dark:text-teal-300 hidden min-[420px]:inline">Handova</span>
          </button>

          <AppNav current={appPage} onNavigate={navigate} placement="top" />
          <div className="flex items-center h-full">
            <span className="hidden sm:block w-px h-6 bg-[var(--border-subtle)] mx-1" aria-hidden="true" />
            <button onClick={() => setShowAbout(true)} aria-label="About Handova" className="flex items-center justify-center w-10 h-10 rounded-md text-slate-600 hover:bg-[var(--surface-3)]">
              <Info size={18} />
            </button>
            <button onClick={toggleDarkMode} aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"} className="flex items-center justify-center w-10 h-10 rounded-md text-slate-600 hover:bg-[var(--surface-3)]">
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button onClick={() => setShowSettings(true)} aria-label="Settings" className="flex items-center justify-center w-10 h-10 rounded-md text-slate-600 hover:bg-[var(--surface-3)]">
              <Settings size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Steps: a tab strip, report page only */}
      {appPage === "report" && (
        <div className="max-w-4xl mx-auto px-3 sm:px-4 pt-4">
          <ol className="flex border-b border-[var(--border-strong)]">
            {STEPS_KEYS.map((key, i) => (
              <li key={key} className="flex-1">
                <button id={`step-${i}`}
                  onClick={() => { if (i===0) setStep(0); if (i===1&&canProceed0) setStep(1); if (i===2) handleGoToReport(); }}
                  aria-current={step === i ? "step" : undefined}
                  className={`w-full flex items-center justify-center gap-2 py-3 text-sm -mb-px border-b-[3px] ${step===i?"step-pill-active":step>i?"step-pill-done border-transparent":"step-pill-todo border-transparent"}`}>
                  <span className="tabular-nums font-bold">{step > i ? "\u2713" : i + 1}</span>
                  <span className="font-bold">{t(lang, key)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-3 sm:px-4 py-6">

        {/* Home */}
        {appPage === "home" && <HomeScreen onNavigate={navigate} />}

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
              <div className="flex border border-[var(--border-strong)] rounded-md overflow-hidden mb-6" role="group" aria-label="Report mode">
                <button
                  onClick={() => setAppMode("quick")}
                  aria-pressed={appMode === "quick"}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold ${appMode === "quick" ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-[#04201A]" : "bg-[var(--surface-1)] text-slate-700 hover:bg-[var(--surface-3)]"}`}
                >
                  <Zap size={16} /> Quick mode
                </button>
                <button
                  onClick={() => setAppMode("structured")}
                  aria-pressed={appMode === "structured"}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold border-l border-[var(--border-strong)] ${appMode === "structured" ? "bg-teal-600 text-white dark:bg-teal-500 dark:text-[#04201A]" : "bg-[var(--surface-1)] text-slate-700 hover:bg-[var(--surface-3)]"}`}
                >
                  <ListChecks size={16} /> Structured mode
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

      <footer className="text-center pt-6 pb-24 sm:pb-6 text-xs text-slate-400 border-t border-slate-200 mt-12">
        Handova v11.1 · AI-Powered Nursing Shift Reports · © 2026
      </footer>

      {/* Phone tab bar: every label visible */}
      <AppNav current={appPage} onNavigate={navigate} placement="bottom" />
    </div>
  );
}
