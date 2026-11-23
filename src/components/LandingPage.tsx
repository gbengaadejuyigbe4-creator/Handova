import { useState, useEffect } from "react";
import { ArrowRight, Download, Share } from "lucide-react";
import ReportHistory from "./ReportHistory";
import Logo from "./Logo";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const STEPS = [
  { n: "1", title: "Enter the shift details", body: "Ward, shift, date and patient flow. Patients at handover is worked out for you." },
  { n: "2", title: "Add each patient", body: "Upload the hospital record as a PDF, then speak or type what happened: medicines, vitals, the doctor's plan, complaints." },
  { n: "3", title: "Check, then copy", body: "Handova drafts the report in the format your hospital uses. You read it, change what you need to, and paste it into your hospital system." },
];

const CAPABILITIES = [
  { title: "Voice notes", body: "Speak your notes and get text. A speech model trained on medical vocabulary helps with drug names and abbreviations." },
  { title: "Hospital record (PDF)", body: "Upload the patient's record saved as a PDF. Handova reads it and fills in what it finds, so you can check it." },
  { title: "Questions for the shift", body: "Short questions about things the record does not answer, so the report is not guesswork." },
  { title: "Care plan and risk flags", body: "Drafts of nursing priorities and things to watch. Always labelled as an AI draft, and meant to be checked against the chart." },
  { title: "Specialist suggestions", body: "On request: things a doctor may want to consider, and information that may be missing from the record. Suggestions only, never orders." },
  { title: "Report formats", body: "Standard, SBAR or ISBAR, with wording for your region." },
];

interface LandingPageProps { onEnterApp: () => void; }

export default function LandingPage({ onEnterApp }: LandingPageProps) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandaloneMode = window.matchMedia("(display-mode: standalone)").matches;
  const showIosHint = isIos && !isInStandaloneMode;

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  };

  return (
    <div className="min-h-screen bg-[var(--page-bg)] text-[var(--text-primary)]">

      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-[var(--surface-1)] border-b border-[var(--border-strong)]">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <a href="#top" className="flex items-center gap-2.5" aria-label="Handova home">
            <Logo size={28} />
            <span className="font-display text-[18px] text-teal-700 dark:text-teal-300">Handova</span>
          </a>
          <nav className="flex items-center gap-1 sm:gap-5 text-sm font-bold">
            <a href="#how-it-works" className="hidden sm:inline text-slate-600 hover:text-slate-900 dark:hover:text-white">How it works</a>
            <a href="#what-it-does" className="hidden sm:inline text-slate-600 hover:text-slate-900 dark:hover:text-white">What it does</a>
            <a href="#your-data" className="hidden sm:inline text-slate-600 hover:text-slate-900 dark:hover:text-white">Your data</a>
            <button onClick={onEnterApp} className="btn-primary text-sm px-4 py-2 min-h-[40px]">Open Handova</button>
          </nav>
        </div>
      </header>

      <main id="top">
        {/* Hero: the product's own output, not a claim about it */}
        <section className="max-w-5xl mx-auto px-5 pt-12 pb-16 sm:pt-16 sm:pb-20 grid lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-14 items-start">
          <div>
            <p className="text-sm font-bold text-teal-700 dark:text-teal-300 mb-4">Built by a practising nurse in Akure</p>
            <h1 className="font-display text-[34px] sm:text-[46px] leading-[1.1] mb-5">
              Shift handover reports, drafted from your own notes.
            </h1>
            <p className="text-[17px] text-slate-700 dark:text-slate-300 leading-relaxed max-w-xl mb-7">
              Speak or type what happened on your shift. Add the hospital record as a PDF. Handova drafts the report and the care plan. You check it, then paste it into your hospital system.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={onEnterApp} className="btn-primary px-6">
                Open Handova <ArrowRight size={16} />
              </button>
              {installPrompt && !installed && (
                <button onClick={handleInstall} className="btn-secondary">
                  <Download size={16} /> Add to home screen
                </button>
              )}
            </div>
            {showIosHint && (
              <p className="mt-3 text-sm text-slate-600 flex items-center gap-1.5">
                <Share size={14} /> On iPhone: tap Share, then Add to Home Screen.
              </p>
            )}
            <p className="mt-6 text-sm text-slate-600 max-w-lg">
              The AI drafts. A nurse checks. Nothing is sent to the hospital system for you.
            </p>
          </div>

          <figure className="report-document" aria-label="Example report">
            <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3">
              <span className="text-sm font-bold">Shift report · Medical ward · Day</span>
              <span className="text-xs text-slate-600">Example, invented patient</span>
            </div>
            <div className="report-document-inner px-5 py-4 space-y-3 text-[15px]">
              <p><b>Situation.</b> Demo Patient, 58, male. Decompensated heart failure, day 2.</p>
              <p><b>Background.</b> On IV furosemide 40 mg twice daily and spironolactone 25 mg daily.</p>
              <p><b>Assessment.</b> BP 150/90, pulse 96, respiratory rate 26, SpO2 93%. Intake and output chart requested; no totals documented yet.</p>
              <p><b>Recommendation.</b> Continue strict intake and output. Raise the missing totals and the day 1 potassium with the doctor on the next round.</p>
            </div>
            <figcaption className="px-5 py-3 border-t border-[var(--border-subtle)] text-xs text-slate-600">
              An AI draft for the nurse to check and edit.
            </figcaption>
          </figure>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="border-t border-[var(--border-strong)] bg-[var(--surface-1)]">
          <div className="max-w-5xl mx-auto px-5 py-14">
            <h2 className="font-display text-[28px] mb-8">How it works</h2>
            <ol className="grid md:grid-cols-3 gap-8">
              {STEPS.map((s) => (
                <li key={s.n} className="border-t-[3px] border-teal-600 dark:border-teal-400 pt-4">
                  <p className="font-display text-[15px] text-teal-700 dark:text-teal-300 tabular-nums mb-1">Step {s.n}</p>
                  <h3 className="font-display text-[19px] mb-2">{s.title}</h3>
                  <p className="text-[15px] text-slate-700 dark:text-slate-300 leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* What it does */}
        <section id="what-it-does" className="border-t border-[var(--border-strong)]">
          <div className="max-w-5xl mx-auto px-5 py-14">
            <h2 className="font-display text-[28px] mb-8">What it does</h2>
            <dl className="grid md:grid-cols-2 gap-x-12">
              {CAPABILITIES.map((c) => (
                <div key={c.title} className="py-4 border-t border-[var(--border-subtle)]">
                  <dt className="font-display text-[17px] mb-1">{c.title}</dt>
                  <dd className="text-[15px] text-slate-700 dark:text-slate-300 leading-relaxed">{c.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Your data: stated accurately */}
        <section id="your-data" className="border-t border-[var(--border-strong)] bg-[var(--surface-1)]">
          <div className="max-w-5xl mx-auto px-5 py-14 grid md:grid-cols-[0.8fr_1.2fr] gap-8">
            <h2 className="font-display text-[28px]">What happens to what you enter</h2>
            <ul className="space-y-3 text-[16px] text-slate-700 dark:text-slate-300 leading-relaxed">
              <li><b>Saved on your device.</b> Reports and drafts are kept in this browser, on this device.</li>
              <li><b>Not kept on our servers.</b> Handova does not store a copy of what you submit.</li>
              <li><b>Sent to AI services.</b> To write the output, the text, audio or PDF content you submit is sent to AI services for speech-to-text and text generation. They process it for that request.</li>
              <li><b>Check your hospital's policy.</b> Find out whether patient information may be shared with AI services, and leave out names where you can.</li>
            </ul>
          </div>
        </section>

        {/* For hospitals */}
        <section className="border-t border-[var(--border-strong)]">
          <div className="max-w-5xl mx-auto px-5 py-12 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <div>
              <h2 className="font-display text-[22px] mb-1">Hospitals and administrators</h2>
              <p className="text-[15px] text-slate-700 dark:text-slate-300 max-w-xl">
                Handova is a working prototype. If your hospital would like to talk about a pilot or about connecting it to your records system, get in touch.
              </p>
            </div>
            <a href="mailto:gbengaadejuyigbe4@gmail.com" className="btn-secondary whitespace-nowrap">
              Contact the builder <ArrowRight size={16} />
            </a>
          </div>
        </section>

        <ReportHistory />
      </main>

      <footer className="border-t border-[var(--border-strong)] bg-[var(--surface-1)]">
        <div className="max-w-5xl mx-auto px-5 py-6 flex items-center gap-3 text-sm text-slate-600">
          <Logo size={20} />
          <span>Handova. Built in Akure by a practising nurse.</span>
        </div>
      </footer>
    </div>
  );
}
