/**
 * AboutPanel.tsx
 *
 * About, How to Use, Privacy, Terms, Disclaimer panels.
 * The "How to Use" section is the main addition — a complete,
 * plain-language guide to every Handova feature written for nurses,
 * not developers.
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useState } from "react";
import {
  X, Heart, Shield, FileText, AlertTriangle, ExternalLink,
  ChevronRight, BookOpen, Zap, Mic, Clock, ToggleLeft,
  Settings, Globe, Download, RefreshCw, Volume2,
} from "lucide-react";
import { Language, t } from "../utils/i18n";
import { loadSettings } from "../utils/settings";

type SubPage = "about" | "howto" | "privacy" | "terms" | "disclaimer";

interface AboutPanelProps {
  onClose: () => void;
  lang: Language;
}

// ─── HOW TO USE — SECTION DATA ────────────────────────────────────────────────

interface HowToSection {
  id: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  steps: { heading?: string; body: string }[];
  tip?: string;
}

const HOW_TO_SECTIONS: HowToSection[] = [
  {
    id: "quickmode",
    icon: Zap,
    iconColor: "text-teal-700",
    iconBg: "bg-teal-50",
    title: "Quick Mode — fastest way",
    subtitle: "Dump your raw thoughts. AI builds the full report.",
    steps: [
      {
        heading: "Open the app and make sure Quick Mode is selected",
        body: "When you first enter the app, you'll see two tabs at the top: ⚡ Quick Mode and ✍️ Structured Mode. Quick Mode is the default.",
      },
      {
        heading: "Type or paste your raw shift notes",
        body: "In the large text box, just type everything you know about the shift — exactly how it comes to your head. You don't need any structure. For example:\n\n\"8 patients taken over. Bed 4 male, HTN, BP 190/110, labetalol given, settled. Bed 7 female epistaxis, doctor reviewed, blood transfusion started. Bed 2 discharged this morning. 1 new admission at 3am, chest pain, ECG done...\"\n\nNo forms. No fields. Just type.",
      },
      {
        heading: "Tap Generate shift report",
        body: "The AI reads your notes, figures out how many patients there are, extracts their details, writes a proper clinical nurse's note for each one, and assembles a complete shift report — all formatted exactly for HMS entry.",
      },
      {
        heading: "Review and copy",
        body: "Read through the generated report. If anything is wrong or missing, you can edit it directly in the text box. When you're satisfied, tap Copy full report and paste it straight into your HMS.",
      },
    ],
    tip: "The AI is trained on numerous real shift reports so it knows authentic clinical language — phrases like \"served and documented\", \"IV access in situ\", \"no complaints on shift\", and \"ensured comfort\" will appear naturally.",
  },
  {
    id: "voicemode",
    icon: Mic,
    iconColor: "text-amber-700",
    iconBg: "bg-amber-50",
    title: "Voice Mode — speak your handover",
    subtitle: "Tap once, talk, and the report writes itself.",
    steps: [
      {
        heading: "Select Quick Mode → tap the Voice tab",
        body: "Inside Quick Mode, you'll see three tabs: Quick type, Voice, and Continue shift. Tap Voice.",
      },
      {
        heading: "Tap the big microphone button",
        body: "The button turns red when recording. Speak naturally — say everything about the shift just as you would tell a colleague.",
      },
      {
        heading: "Pause for 1.5 seconds to stop",
        body: "The app detects silence automatically. When you stop speaking for 1.5 seconds, recording stops and transcription begins. Or tap the button again to stop manually.",
      },
      {
        heading: "Review the transcription, then generate",
        body: "Your spoken words appear as text. Read through to confirm it captured correctly, then tap Generate shift report.",
      },
    ],
    tip: "Speak clearly and mention bed numbers or patient names to help the AI separate patients. For example: \"Bed 4, male patient with hypertension...\" then \"Next patient, Bed 7, female with epistaxis...\"",
  },
  {
    id: "continueshift",
    icon: Clock,
    iconColor: "text-blue-700",
    iconBg: "bg-blue-50",
    title: "Continue Shift — carry over yesterday",
    subtitle: "Load your last report. Just say what changed.",
    steps: [
      {
        heading: "Select Quick Mode → tap the Continue shift tab",
        body: "This mode is for nurses coming back after a break or continuing the same ward the next day. You'll see your last 3 saved reports.",
      },
      {
        heading: "Select the previous shift to carry over",
        body: "Tap the shift report you want to continue from. It will be highlighted.",
      },
      {
        heading: "Tell the AI what changed",
        body: "In the text box or by speaking, describe only what is different this shift:\n\n\"Bed 4 BP improved to 130/80, still on same meds. Bed 7 blood transfusion completed, PCV now 32. Bed 2 was discharged. New admission Bed 3, female, 45yrs, DM...\"\n\nYou don't need to repeat what stayed the same — the AI handles that.",
      },
      {
        heading: "Generate the updated report",
        body: "The AI merges your changes with the previous report, updates the affected patients, keeps the unchanged ones, and produces a fresh HMS-ready report for the current shift.",
      },
    ],
    tip: "This feature saves the most time when you have many stable patients who don't change much between shifts — you only describe what actually changed.",
  },
  {
    id: "structuredmode",
    icon: FileText,
    iconColor: "text-slate-600",
    iconBg: "bg-slate-100",
    title: "Structured Mode — complete documentation",
    subtitle: "Fill every field for a fully detailed, complete report.",
    steps: [
      {
        heading: "Step 1 — Shift Information",
        body: "Select your ward, shift type (Morning / Afternoon / Night), and today's date. Then fill in the patient flow numbers: how many patients you took over, how many were admitted, transferred, discharged, or left DAMA. Handova automatically calculates patients remaining at handover.",
      },
      {
        heading: "Step 2 — Add each patient",
        body: "For each patient, fill in their demographics (name, age, gender, ward, bed number, admission date), diagnosis, and how they arrived this shift. The arrival type is important — it determines how the AI opens the nurse's note:\n\n• Taken over at shift start → \"The patient was taken over in a fair state of health...\"\n• Rushed in → \"The patient was rushed into the Emergency on account of...\"\n• Walked in → \"The patient walked into the ward on account of...\"",
      },
      {
        heading: "Add Doctor's Ward Round Plan (if any)",
        body: "If the doctor reviewed the patient during your shift, type their plan here. The AI will weave this naturally into the nurse's note narrative.",
      },
      {
        heading: "Type or speak the Shift Events",
        body: "This is the most important field. Type or speak everything that happened during your shift for that patient — their condition, interventions, medications given, complaints, responses to treatment, procedures done.\n\nThen tap Generate Nurses' Note. The AI converts your raw events into a professional clinical narrative.",
      },
      {
        heading: "Fill in Vitals and Medications",
        body: "Enter vital signs at end of shift (BP, Pulse, RR, Temp, SpO2, RBS) and list medications administered. These appear separately in the report.",
      },
      {
        heading: "Step 3 — View and Copy the full report",
        body: "Once all patients have generated notes, tap View Full Report. The complete shift report assembles automatically. Review it, then copy and paste into your HMS.",
      },
    ],
    tip: "You can switch between Standard format (clinical narrative) and SBAR format (Situation, Background, Assessment, Recommendation) using the toggle above the Generate button. SBAR is the international standard used globally.",
  },
  {
    id: "sbar",
    icon: ToggleLeft,
    iconColor: "text-purple-700",
    iconBg: "bg-purple-50",
    title: "SBAR Format — international standard",
    subtitle: "Switch between standard narrative and global SBAR.",
    steps: [
      {
        heading: "What is SBAR?",
        body: "SBAR stands for Situation, Background, Assessment, Recommendation. It is the internationally recognised clinical handover framework used by the NHS (UK), WHO, Joint Commission (USA), and hospitals worldwide.",
      },
      {
        heading: "How to switch to SBAR",
        body: "In Structured Mode: each patient card has a Standard / SBAR toggle just above the Generate button. Switch it before tapping Generate.\n\nIn Quick Mode: the SBAR toggle is at the bottom of the screen, above the Generate button.",
      },
      {
        heading: "What SBAR output looks like",
        body: "S — SITUATION: Who the patient is and their current condition.\nB — BACKGROUND: Admission history, investigations, ongoing treatment.\nA — ASSESSMENT: Everything that happened this shift — full clinical narrative.\nR — RECOMMENDATION: What the oncoming nurse must watch for, pending actions.",
      },
      {
        heading: "When to use SBAR",
        body: "Use SBAR if your facility has adopted the international standard. Use Standard format for traditional running narratives in your HMS.",
      },
    ],
    tip: "In the Report Output page (Step 3), there is also a Standard / SBAR toggle that switches the entire assembled report format — not just individual patient notes.",
  },
  {
    id: "voice-input",
    icon: Volume2,
    iconColor: "text-red-700",
    iconBg: "bg-red-50",
    title: "Voice Input — in Structured Mode",
    subtitle: "Speak shift events directly into each patient card.",
    steps: [
      {
        heading: "Find the Speak shift events button",
        body: "Inside each patient card in Step 2, next to the Shift Events label, you'll see a microphone button labelled 'Speak shift events'.",
      },
      {
        heading: "Tap and speak",
        body: "Tap the button and speak what happened for that specific patient. After 1.5 seconds of silence, the recording stops and your words are transcribed into the Shift Events text box.",
      },
      {
        heading: "Transcription is additive",
        body: "Each time you speak, the transcript is added to the end of whatever text is already there. So you can speak in parts — pause, check, continue speaking — and it all accumulates.",
      },
      {
        heading: "Then generate the note",
        body: "Once you're done speaking, tap Generate Nurses' Note. The AI processes what you said and writes the clinical narrative.",
      },
    ],
    tip: "This uses Deepgram Nova 3 Medical — an AI model specifically trained on medical and clinical vocabulary. It understands drug names, clinical terms, and various accents better than standard speech recognition.",
  },
  {
    id: "settings",
    icon: Settings,
    iconColor: "text-teal-700",
    iconBg: "bg-teal-50",
    title: "Settings — personalise Handova",
    subtitle: "Set your name, facility, and preferences once.",
    steps: [
      {
        heading: "Open Settings",
        body: "Tap the Settings icon (⚙️) in the top right corner of the app.",
      },
      {
        heading: "Enter your profile",
        body: "Add your name (e.g. Gbenga Adejuyigbe) and credentials (e.g. RN, BNSc). These will automatically appear in the report footer — so you never have to type them again.",
      },
      {
        heading: "Set your facility name",
        body: "Enter your hospital or facility name (e.g. Lagos University Teaching Hospital). This replaces the default footer.",
      },
      {
        heading: "Set your default ward",
        body: "Choose your most common ward. Every new patient you add will have this ward pre-filled — saving you time when all patients are on the same ward.",
      },
      {
        heading: "Set default shift and report format",
        body: "If you usually work night shifts, set Night as default. If your facility uses SBAR, set SBAR as default. These pre-select every time you open the app.",
      },
    ],
    tip: "Settings are saved on your device. They don't sync between devices — so if you use Handova on both your phone and a hospital computer, set them up on each one.",
  },
  {
    id: "language",
    icon: Globe,
    iconColor: "text-indigo-700",
    iconBg: "bg-indigo-50",
    title: "Language — English, French, Arabic",
    subtitle: "Switch the app interface to your preferred language.",
    steps: [
      {
        heading: "Open Settings → Language",
        body: "Tap Settings (⚙️) in the top right. Under the Language section, you'll see three options: English, Français (French), and العربية (Arabic).",
      },
      {
        heading: "Select your language and save",
        body: "Tap your preferred language and tap Save Settings. The entire app interface — every button, label, placeholder, and error message — switches immediately.",
      },
      {
        heading: "Arabic switches the layout to right-to-left",
        body: "When Arabic is selected, the app layout mirrors itself — text flows right to left, navigation moves to the right side, exactly as Arabic readers expect.",
      },
    ],
    tip: "The generated report content (the actual nurse's notes) is always in English, since that is the universal language for clinical documentation in many regions. Only the app interface translates.",
  },
  {
    id: "drafts",
    icon: RefreshCw,
    iconColor: "text-green-700",
    iconBg: "bg-green-50",
    title: "Drafts — your work is always saved",
    subtitle: "Never lose a half-written report again.",
    steps: [
      {
        heading: "Auto-save happens in the background",
        body: "Every time you type, Handova automatically saves your work to your device. You don't need to press any save button.",
      },
      {
        heading: "Restore when you return",
        body: "If you close the app and come back — even days later — you'll see a banner at the top: \"Continue your last report?\" Tap Restore to pick up exactly where you left off. Tap Discard to start fresh.",
      },
      {
        heading: "Report history",
        body: "Every report you complete is saved to your history (last 5 reports). In Quick Mode's Continue Shift tab, you can see and load these previous reports.",
      },
    ],
    tip: "Drafts are saved only on your device — they don't upload anywhere. If you use a different device or a different browser, your draft won't be there. Always copy your finished report to your HMS before closing.",
  },
  {
    id: "pwa",
    icon: Download,
    iconColor: "text-teal-700",
    iconBg: "bg-teal-50",
    title: "Install Handova on your phone",
    subtitle: "Add to home screen for instant access.",
    steps: [
      {
        heading: "On Android (Chrome)",
        body: "Open handova.vercel.app in Chrome. Tap the three-dot menu (⋮) in the top right. Tap 'Add to Home screen'. Tap Add. Handova will appear on your home screen as an app.",
      },
      {
        heading: "On iPhone (Safari)",
        body: "Open handova.vercel.app in Safari. Tap the Share button (the box with an arrow pointing up). Scroll down and tap 'Add to Home Screen'. Tap Add. Handova will appear on your home screen as an app.",
      },
      {
        heading: "Why install it?",
        body: "Once installed, Handova opens fullscreen — no browser bars. It loads faster, works better on mobile, and feels like a native app. You can open it directly from your home screen without typing the URL.",
      },
    ],
    tip: "Installing Handova as a PWA (Progressive Web App) doesn't download a large file — it just creates a shortcut that loads the web app faster. You always have the latest version automatically.",
  },
];

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function AboutPanel({ onClose, lang }: AboutPanelProps) {
  const [subPage, setSubPage] = useState<SubPage>("about");
  const [expandedSection, setExpandedSection] = useState<string | null>("quickmode");
  const settings = loadSettings();

  const version = "10.5.1";
  const author = settings.nurseName && settings.nurseCredentials
    ? `${settings.nurseName}, ${settings.nurseCredentials}`
    : "Gbenga Adejuyigbe, RN, BNSc";

  const toggleSection = (id: string) => {
    setExpandedSection(prev => prev === id ? null : id);
  };

  return (
    <div className="fixed inset-0 z-[200] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl overflow-y-auto flex flex-col">

        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            {subPage !== "about" && (
              <button
                onClick={() => setSubPage("about")}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <ChevronRight size={14} className="rotate-180" />
              </button>
            )}
            <h2 className="text-lg font-bold text-slate-900">
              {subPage === "about" && t(lang, "aboutTitle")}
              {subPage === "howto" && "How to use Handova"}
              {subPage === "privacy" && t(lang, "privacyTitle")}
              {subPage === "terms" && t(lang, "termsTitle")}
              {subPage === "disclaimer" && t(lang, "disclaimerTitle")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 px-6 py-6">

          {/* ── ABOUT ── */}
          {subPage === "about" && (
            <div className="space-y-6">
              {/* App identity */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 shadow-md">
                  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                    <rect width="48" height="48" rx="12" fill="#0D9488"/>
                    <path d="M13 12h5v10h12V12h5v24h-5V27H18v9h-5V12z" fill="white" opacity="0.95"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Handova</h3>
                  <p className="text-sm text-slate-500">Version {version}</p>
                  <p className="text-xs text-teal-600 mt-1">AI-Powered Nursing Shift Documentation</p>
                </div>
              </div>

              <p className="text-sm text-slate-600 leading-relaxed">
                Built by a nurse, for nurses — designed for global use.
              </p>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: "~35min", label: "Saved per shift" },
                  { value: "3", label: "Languages" },
                  { value: "2", label: "Report formats" },
                ].map(s => (
                  <div key={s.label} className="bg-teal-50 rounded-xl p-3 text-center">
                    <p className="text-lg font-bold text-teal-700">{s.value}</p>
                    <p className="text-[10px] text-teal-600 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* How to use — prominent link */}
              <button
                onClick={() => setSubPage("howto")}
                className="w-full flex items-center justify-between bg-teal-600 hover:bg-teal-700 text-white px-5 py-4 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-3">
                  <BookOpen size={18} />
                  <div className="text-left">
                    <p className="text-sm font-bold">How to use Handova</p>
                    <p className="text-xs text-teal-200 mt-0.5">Complete guide to every feature</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-teal-200" />
              </button>

              {/* Author */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">{t(lang, "builtBy")}</p>
                <p className="text-sm font-semibold text-slate-800">{author}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {settings.facilityName || "Nigeria Police Medical Services, Akure"}
                </p>
                <p className="text-xs text-slate-400 mt-1">© 2026</p>
              </div>

              {/* Feedback */}
              <div className="border border-teal-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Heart size={14} className="text-teal-600" />
                  <h4 className="text-sm font-bold text-slate-800">{t(lang, "feedbackTitle")}</h4>
                </div>
                <p className="text-xs text-slate-500 mb-3">{t(lang, "feedbackDesc")}</p>
                <a
                  href="mailto:feedback@handova.app?subject=Handova Feedback"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-600 hover:text-teal-700"
                >
                  <ExternalLink size={12} /> {t(lang, "sendFeedback")}
                </a>
              </div>

              {/* Legal links */}
              <div className="space-y-1">
                {([
                  { page: "disclaimer" as SubPage, icon: AlertTriangle, label: t(lang, "medicalDisclaimer"), color: "text-amber-600" },
                  { page: "privacy" as SubPage, icon: Shield, label: t(lang, "privacyPolicy"), color: "text-blue-600" },
                  { page: "terms" as SubPage, icon: FileText, label: t(lang, "termsOfService"), color: "text-slate-600" },
                ]).map(item => (
                  <button
                    key={item.page}
                    onClick={() => setSubPage(item.page)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <item.icon size={15} className={item.color} />
                      <span className="text-sm text-slate-700">{item.label}</span>
                    </div>
                    <ChevronRight size={14} className="text-slate-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── HOW TO USE ── */}
          {subPage === "howto" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 leading-relaxed mb-4">
                Everything you need to know about Handova — written for nurses, not tech people.
                Tap any section to expand it.
              </p>

              {HOW_TO_SECTIONS.map((section) => {
                const Icon = section.icon;
                const isOpen = expandedSection === section.id;
                return (
                  <div
                    key={section.id}
                    className={`border rounded-xl overflow-hidden transition-all duration-200 ${
                      isOpen ? "border-teal-300 shadow-sm" : "border-slate-200"
                    }`}
                  >
                    {/* Section header — always visible */}
                    <button
                      onClick={() => toggleSection(section.id)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors"
                    >
                      <div className={`w-8 h-8 rounded-lg ${section.iconBg} flex items-center justify-center flex-shrink-0`}>
                        <Icon size={15} className={section.iconColor} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{section.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{section.subtitle}</p>
                      </div>
                      <ChevronRight
                        size={14}
                        className={`text-slate-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                      />
                    </button>

                    {/* Section body — expanded */}
                    {isOpen && (
                      <div className="px-4 pb-4 space-y-4 border-t border-slate-100">
                        <div className="space-y-4 pt-4">
                          {section.steps.map((step, i) => (
                            <div key={i} className="flex gap-3">
                              <div className="w-5 h-5 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                                {i + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                {step.heading && (
                                  <p className="text-xs font-bold text-slate-800 mb-1">{step.heading}</p>
                                )}
                                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{step.body}</p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {section.tip && (
                          <div className="bg-teal-50 border border-teal-200 rounded-lg px-3 py-2.5">
                            <p className="text-[10px] font-bold text-teal-700 uppercase tracking-wider mb-1">Pro tip</p>
                            <p className="text-xs text-teal-800 leading-relaxed">{section.tip}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Bottom CTA */}
              <div className="pt-2 pb-4">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Still have questions? Tap the feedback button and we'll help you out.
                  </p>
                  <a
                    href="mailto:feedback@handova.app?subject=Handova Question"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-600 hover:text-teal-700 mt-3"
                  >
                    <ExternalLink size={12} /> Contact support
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* ── DISCLAIMER ── */}
          {subPage === "disclaimer" && (
            <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={16} className="text-amber-600" />
                  <p className="font-bold text-amber-800">Important Notice</p>
                </div>
                <p className="text-amber-700 text-xs">Please read this disclaimer carefully before using Handova.</p>
              </div>
              <p>Handova is a <strong>documentation assistance tool</strong> designed to help nurses format and organise their shift handover notes. It is <strong>not a medical device</strong>, diagnostic tool, or clinical decision support system.</p>
              <p>The AI-generated content in Handova is based solely on the information provided by the nurse. The AI does not have access to the patient's medical records, test results, or clinical history beyond what is entered.</p>
              <p><strong>Handova does not:</strong></p>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>Provide medical diagnoses or clinical recommendations</li>
                <li>Replace professional nursing judgment</li>
                <li>Constitute medical advice of any kind</li>
                <li>Access or transmit patient-identifiable data to third parties</li>
              </ul>
              <p>All generated notes must be reviewed by the nurse before use. The nurse remains fully responsible for the accuracy and completeness of all clinical documentation.</p>
              <p>By using Handova, you acknowledge that you are a qualified healthcare professional and that you take full responsibility for all documentation produced using this tool.</p>
            </div>
          )}

          {/* ── PRIVACY ── */}
          {subPage === "privacy" && (
            <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
              <p className="font-semibold text-slate-800">Your privacy is important to us.</p>
              <p><strong>What data we collect:</strong> Handova stores your settings (name, facility, preferences) and shift report drafts locally on your device using your browser's localStorage. This data never leaves your device.</p>
              <p><strong>What data we send to servers:</strong> When you use voice transcription, audio is sent securely to Deepgram for processing. When you generate a nurse's note, the shift event text is sent to Groq for AI processing. Neither service stores your data beyond the immediate request.</p>
              <p><strong>Patient data:</strong> We strongly advise against entering full patient names or identifying information into the app. Use initials or bed numbers where possible. Any data you enter is processed in transit but not stored on our servers.</p>
              <p><strong>Nigeria Data Protection Act (NDPA) 2023:</strong> Handova is designed to be compliant with the NDPA. We do not collect, store, or share personal data on our servers.</p>
              <p><strong>GDPR (EU):</strong> If you are using Handova in the European Union, the same protections apply. No personal data is stored server-side.</p>
              <p>For questions about privacy, contact: privacy@handova.app</p>
              <p className="text-xs text-slate-400">Last updated: March 2026</p>
            </div>
          )}

          {/* ── TERMS ── */}
          {subPage === "terms" && (
            <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
              <p className="font-semibold text-slate-800">Terms of Service — Handova</p>
              <p>By using Handova, you agree to these terms. Please read them carefully.</p>
              <p><strong>1. Eligibility:</strong> Handova is intended for use by qualified, registered healthcare professionals only. By using this app, you confirm that you are a licensed nurse, doctor, or other qualified healthcare provider.</p>
              <p><strong>2. Permitted use:</strong> Handova may be used for legitimate clinical documentation purposes within a healthcare setting. You may not use Handova for any unlawful purpose.</p>
              <p><strong>3. Clinical responsibility:</strong> You are solely responsible for all clinical decisions and documentation produced using Handova. The AI-generated content must be reviewed and verified by a qualified professional before use.</p>
              <p><strong>4. No warranty:</strong> Handova is provided "as is" without warranty of any kind. We do not guarantee the accuracy, completeness, or fitness for purpose of any AI-generated content.</p>
              <p><strong>5. Intellectual property:</strong> Handova and its underlying technology are the property of Gbenga Adejuyigbe. You may not copy, reproduce, or distribute the app without permission.</p>
              <p><strong>6. Changes to terms:</strong> We reserve the right to update these terms at any time. Continued use of Handova constitutes acceptance of updated terms.</p>
              <p className="text-xs text-slate-400">Last updated: March 2026</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
