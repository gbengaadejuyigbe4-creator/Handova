import { useState, useEffect, useRef } from "react";
import {
  ArrowRight, Mic, FileText, Shield,
  CheckCircle, Stethoscope, Building2, Zap,
  Download, Share, Brain, ClipboardList,
  type LucideIcon
} from "lucide-react";
import ReportHistory from "./ReportHistory";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface Stat { value: string; label: string; sub?: string; }
interface Feature { icon: LucideIcon; title: string; desc: string; tag?: string; }

const STATS: Stat[] = [
  { value: "< 5 min", label: "Report generation", sub: "From notes to EMR-ready text" },
  { value: "40 min", label: "Saved per shift", sub: "Returned to patient care" },
  { value: "SBAR+", label: "Global formats", sub: "SBAR · ISBAR · Standard" },
  { value: "Zero", label: "Data stored", sub: "No servers, no retention" },
];

const FEATURES: Feature[] = [
  { icon: Mic, title: "Medical Voice Transcription", desc: "Deepgram Nova-3-Medical — trained on clinical vocabulary — transcribes drug names, dosages, and clinical abbreviations with near-perfect accuracy across accents.", tag: "AI" },
  { icon: Brain, title: "Smart EMR Integration", desc: "Upload your EMR or hospital system PDF export. Handova reads the full clinical record, generates specific questions, and pre-fills your report with verified data.", tag: "New" },
  { icon: ClipboardList, title: "Shift Care Planner", desc: "Multi-patient shift planning with time-structured, evidence-based nursing interventions. Nurse-to-patient ratio aware. Generates a combined timeline for the full shift.", tag: "New" },
  { icon: FileText, title: "Complete Shift Reports", desc: "Patient flow, nurses' notes, vitals, medications, and doctor's plans — assembled in SBAR, ISBAR, or Standard format to match your hospital's requirements.", },
  { icon: Stethoscope, title: "Built by a Practising Nurse", desc: "Every clinical phrase, every workflow decision, every format choice comes from real ward experience. Not a developer's assumption — a nurse's lived reality.", },
  { icon: Shield, title: "Zero Data Retention", desc: "No patient data is ever stored. API calls are processed and discarded immediately. No account. No login. No cloud storage of any kind.", },
];

const WORKFLOW = [
  {
    step: "01",
    title: "Enter shift information",
    desc: "Select your ward, shift type, date, and region. Enter patient flow numbers — taken over, admissions, transfers, discharges. Patients at handover is calculated automatically.",
    accent: "teal",
  },
  {
    step: "02",
    title: "Add patients and speak shift events",
    desc: "For each patient, enter their name and diagnosis. Upload their EMR PDF to auto-fill and generate targeted clinical questions. Then speak or type what happened — medications, vitals, doctor's plan, complaints, procedures.",
    accent: "teal",
    highlight: true,
  },
  {
    step: "03",
    title: "Generate, review, and copy",
    desc: "One tap generates a complete nurses' note in correct clinical language for your region. Choose Standard, SBAR, or ISBAR format. Review the assembled report, copy it, paste directly into your EMR.",
    accent: "peach",
  },
];

function AnimatedStat({ value, label, sub, delay }: Stat & { delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.2 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="text-center px-4"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: `opacity 0.55s ease ${delay}ms, transform 0.55s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      }}
    >
      <div className="font-display text-3xl md:text-4xl font-semibold gradient-text-teal mb-1.5 font-tabular leading-none">{value}</div>
      <div className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-0.5">{label}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

interface LandingPageProps { onEnterApp: () => void; }

export default function LandingPage({ onEnterApp }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false);
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

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <div className="min-h-screen mesh-bg text-slate-900 dark:text-slate-100 transition-colors">

      {/* ── Nav ── */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "glass border-b border-white/10 dark:border-white/5 py-4" : "py-6 bg-transparent"
      }`}>
        <div className="max-w-6xl mx-auto px-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl overflow-hidden shadow-lg shadow-teal-900/40 flex-shrink-0">
              <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <rect width="48" height="48" rx="12" fill="url(#logoGrad)"/>
                <defs>
                  <linearGradient id="logoGrad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#0D9488"/>
                    <stop offset="100%" stopColor="#0A7A6F"/>
                  </linearGradient>
                </defs>
                <path d="M13 12h5v10h12V12h5v24h-5V27H18v9h-5V12z" fill="white" opacity="0.96"/>
                <rect x="20" y="20" width="8" height="2" rx="1" fill="white" opacity="0.4"/>
              </svg>
            </div>
            <span className="font-display text-xl font-semibold text-slate-900 dark:text-white tracking-tight">Handova</span>
          </div>

          <div className="flex items-center gap-1.5">
            <a href="#how-it-works" className="hidden md:block text-sm text-slate-600 dark:text-slate-400 hover:text-teal-600 dark:hover:text-white transition-colors px-3 py-2 font-medium">How it works</a>
            <a href="#features" className="hidden md:block text-sm text-slate-600 dark:text-slate-400 hover:text-teal-600 dark:hover:text-white transition-colors px-3 py-2 font-medium">Features</a>
            {!installed && installPrompt && (
              <button onClick={handleInstall} className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-white/10 hover:border-slate-400 dark:hover:border-white/20 hover:text-slate-900 dark:hover:text-white transition-all">
                <Download size={13} /> Install
              </button>
            )}
            <button onClick={onEnterApp} className="btn-primary text-sm px-6 py-3 shadow-[0_0_20px_rgba(20,184,166,0.3)]">
              Open App <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative pt-36 pb-32 px-6 overflow-hidden">
        {/* Background glows */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-24 left-1/3 w-[600px] h-[600px] rounded-full blur-[120px] bg-[rgba(13,148,136,0.15)]" />
          <div className="absolute top-40 right-1/4 w-[400px] h-[400px] rounded-full blur-[100px] bg-[rgba(244,149,106,0.10)]" />
          {/* ECG line */}
          <svg className="absolute top-28 right-12 opacity-[0.06] hidden lg:block" width="380" height="90" viewBox="0 0 380 90">
            <polyline
              points="0,45 48,45 64,12 76,78 88,45 140,45 156,22 168,68 180,45 232,45 248,6 260,84 272,45 380,45"
              fill="none" stroke="#14b8a6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
          <svg className="absolute bottom-24 left-12 opacity-[0.04] hidden lg:block" width="280" height="70" viewBox="0 0 280 70">
            <polyline
              points="0,35 36,35 48,9 58,61 68,35 104,35 116,17 126,53 136,35 172,35 184,4 196,66 208,35 280,35"
              fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
          {/* Grid overlay */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(20,184,166,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(20,184,166,0.03)_1px,transparent_1px)] bg-[size:60px_60px]" />
        </div>

        <div className="max-w-4xl mx-auto text-center relative">
          {/* Premium Glowing Badge */}
          <div className="group inline-flex items-center gap-3 px-5 py-2.5 rounded-full text-[13px] font-semibold mb-10 fade-up relative overflow-hidden transition-all duration-500 hover:scale-105"
            style={{
              background: 'linear-gradient(145deg, rgba(13,148,136,0.1) 0%, rgba(13,148,136,0.02) 100%)',
              border: '1px solid rgba(45,212,191,0.2)',
              boxShadow: '0 0 20px rgba(45,212,191,0.15), inset 0 0 20px rgba(45,212,191,0.05)',
              backdropFilter: 'blur(12px)'
            }}>
            {/* Inner glow effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-teal-500/0 via-teal-400/10 to-teal-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 blur-md" />
            
            {/* Beating pulse dot */}
            <div className="relative flex items-center justify-center">
              <span className="absolute w-2.5 h-2.5 rounded-full bg-teal-400 opacity-60 animate-ping" />
              <span className="relative w-2 h-2 rounded-full bg-teal-300 shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
            </div>
            
            <span className="text-teal-800 dark:text-teal-200 tracking-wide font-display">
              Built by a Practising Nurse <span className="opacity-40 mx-1">|</span> Born on the wards of Akure
            </span>
          </div>

          {/* Headline */}
          <h1 className="font-display text-slate-900 dark:text-white leading-[1.04] mb-7 fade-up-1 text-[clamp(42px,7vw,84px)] tracking-[-0.03em]">
            Shift reports in{" "}
            <span className="gradient-text italic">5 minutes.</span>
            <br />
            <span className="text-slate-600 dark:text-slate-500">Not 40.</span>
          </h1>

          {/* Sub */}
          <p className="text-slate-700 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed mb-10 fade-up-2 text-[clamp(15px,2.2vw,19px)]">
            AI-powered nursing shift report generator used by nurses worldwide.
            Speak your shift events. Upload your EMR export. Get a complete, perfectly formatted report
            — ready to paste into any hospital system.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 fade-up-3">
            <button onClick={onEnterApp} className="btn-primary px-9 py-4 w-full sm:w-auto text-[15px]">
              Generate Your First Report <ArrowRight size={16} />
            </button>
            {!installed && installPrompt && (
              <button onClick={handleInstall}
                className="flex items-center gap-2 px-9 py-4 rounded-xl font-semibold w-full sm:w-auto text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-white/12 hover:border-slate-400 dark:hover:border-white/22 hover:text-slate-900 dark:hover:text-white transition-all bg-white/50 dark:bg-white/5 text-[15px]">
                <Download size={16} /> Install App
              </button>
            )}
            {!installPrompt && !showIosHint && (
              <a href="#how-it-works"
                className="flex items-center gap-2 px-9 py-4 rounded-xl font-semibold w-full sm:w-auto justify-center text-slate-700 dark:text-slate-400 border border-slate-300 dark:border-white/8 hover:border-slate-400 dark:hover:border-white/18 hover:text-slate-900 dark:hover:text-slate-200 transition-all bg-white/50 dark:bg-white/5 text-[15px]">
                See how it works
              </a>
            )}
          </div>

          {showIosHint && (
            <div className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-400 fade-up-3 border border-slate-200 dark:border-white/10 bg-white/50 dark:bg-white/5">
              <Share size={14} className="text-teal-600 dark:text-teal-400 flex-shrink-0" />
              Tap <span className="text-teal-700 dark:text-teal-300 font-semibold mx-1">Share</span> then <span className="text-teal-700 dark:text-teal-300 font-semibold ml-1">Add to Home Screen</span>
            </div>
          )}

          {/* Trust signals */}
          <div className="flex items-center justify-center gap-6 mt-14 fade-up-4">
            {[
              { icon: Shield, text: "No data stored" },
              { icon: Zap, text: "No login required" },
              { icon: CheckCircle, text: "Free to use" },
            ].map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-slate-500">
                <Icon size={13} className="text-teal-600" />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats — embedded cleanly ── */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="glass rounded-[32px] px-8 py-12">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 divide-x divide-slate-100">
              {STATS.map((s, i) => (
                <AnimatedStat key={i} {...s} delay={i * 80} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-24 px-6 relative">
        <div className="max-w-4xl mx-auto relative z-10">
          <div className="text-center mb-16">
            <p className="section-label mb-3">How it works</p>
            <h2 className="font-display text-3xl md:text-5xl font-semibold leading-tight">
              From raw notes to a full report<br />
              <span className="gradient-text italic">in three steps.</span>
            </h2>
          </div>

          <div className="space-y-4">
            {WORKFLOW.map((step, i) => (
              <div key={i} className={`flex gap-6 items-start p-7 rounded-2xl border transition-all duration-300 ${
                step.highlight
                  ? "border-teal-200 bg-white shadow-[0_4px_24px_rgba(20,184,166,0.10)]"
                  : "border-slate-200 bg-white shadow-[0_1px_6px_rgba(12,27,46,0.06)]"
              }`}>
                <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center font-display text-lg font-bold text-white ${
                  step.accent === 'peach'
                    ? "bg-gradient-to-br from-[#D9622A] to-[#F4956A] shadow-[0_4px_14px_rgba(217,98,42,0.3)]"
                    : "bg-gradient-to-br from-[#0A8579] to-[#14B8A6] shadow-[0_4px_14px_rgba(13,148,136,0.3)]"
                }`}>
                  {step.step}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900 mb-2 text-base">{step.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="section-label mb-3">What Handova does</p>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-slate-900 leading-tight">
              Everything a shift report needs.
              <br />
              <span className="gradient-text-teal italic">Nothing it doesn't.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <div key={i} className="feature-card">
                {f.tag && (
                  <span className={`absolute top-4 right-4 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest ${
                    f.tag === 'New' ? 'bg-teal-100 text-teal-900' : 'bg-indigo-50 text-indigo-800'
                  }`}>
                    {f.tag}
                  </span>
                )}
                <div className="icon-container-teal mb-5">
                  <f.icon size={18} className="text-teal-600" />
                </div>
                <h3 className="font-semibold text-slate-900 mb-2.5 text-sm leading-snug">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For Nurses / Admins ── */}
      <section className="py-24 px-6 bg-[#F0F4F8]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="section-label mb-3">Built for everyone involved</p>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-slate-900 leading-tight">
              Whether you're at the bedside<br />
              <span className="gradient-text-teal italic">or behind the desk.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Nurses */}
            <div className="rounded-2xl p-8 border border-teal-200 bg-gradient-to-br from-[#F0FDF9] to-white shadow-[0_4px_24px_rgba(20,184,166,0.10)]">
              <div className="flex items-center gap-3 mb-7">
                <div className="icon-container-teal">
                  <Stethoscope size={18} className="text-teal-600" />
                </div>
                <div>
                  <p className="section-label text-[10px]">For Nurses</p>
                  <p className="text-slate-900 font-bold text-sm mt-0.5">At the bedside</p>
                </div>
              </div>
              <ul className="space-y-3.5 mb-8">
                {[
                  "Speak or type shift events in plain language",
                  "AI generates clinical narrative automatically",
                  "Upload EMR PDF to pre-fill patient details",
                  "Region-aware formatting — SBAR, ISBAR, and more",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
                    <div className="w-4 h-4 rounded-full bg-teal-100 border border-teal-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle size={10} className="text-teal-600" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
              <button onClick={onEnterApp} className="btn-primary w-full justify-center text-sm">
                Start Writing Reports <ArrowRight size={14} />
              </button>
            </div>

            {/* Admins */}
            <div className="rounded-2xl p-8 border border-[#FFE4D6] bg-gradient-to-br from-[#FFF5F0] to-white shadow-[0_4px_24px_rgba(217,98,42,0.08)]">
              <div className="flex items-center gap-3 mb-7">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-[#FFCAB0] bg-gradient-to-br from-[#FFF5F0] to-[#FFE4D6] shadow-[0_2px_8px_rgba(217,98,42,0.12)]">
                  <Building2 size={18} className="text-orange-500" />
                </div>
                <div>
                  <p className="section-label text-[10px] text-[#D9622A]">For Administrators</p>
                  <p className="text-slate-900 font-bold text-sm mt-0.5">At the institutional level</p>
                </div>
              </div>
              <ul className="space-y-3.5 mb-8">
                {[
                  "Reduce documentation time across all wards",
                  "Consistent, standardised report format",
                  "Integration-ready for any hospital EMR",
                  "No infrastructure changes required",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
                    <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 bg-[#FFE4D6] border border-[#FFCAB0]">
                      <CheckCircle size={10} className="text-orange-500" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
              <a href="mailto:gbengaadejuyigbe4@gmail.com"
                className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-bold border border-[#FFCAB0] text-[#D9622A] transition-all hover:bg-orange-50">
                Discuss Integration <ArrowRight size={14} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Privacy note ── */}
      <section className="py-6 px-6 bg-white border-y border-slate-100">
        <div className="max-w-3xl mx-auto flex items-start gap-5 p-6 rounded-2xl bg-gradient-to-br from-[#FFF5F0] to-[#FFFBF8] border border-[#FFE4D6]">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg bg-[#FFCAB0] border border-[#FFB08A]">
            🔒
          </div>
          <div>
            <h3 className="font-bold text-slate-900 mb-1 text-sm">Your patient data never leaves your device</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Handova does not store any patient information on any server. The AI only receives the text you type or speak — processed and discarded immediately. All draft saving happens locally in your browser. No account, no login, no data retention of any kind.
            </p>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-28 px-6 hero-bg">
        <div className="max-w-3xl mx-auto text-center">
          <p className="section-label-light mb-5">Ready to save time?</p>
          <h2 className="font-display font-semibold text-white mb-5 leading-tight text-[clamp(32px,5.5vw,56px)]">
            Your next shift report<br />
            <span className="gradient-text-light italic">starts here.</span>
          </h2>
          <p className="text-slate-400 mb-10 leading-relaxed text-[15px]">
            Free to use. No account required. Works on any phone or laptop.<br />
            Born on the wards of Akure. Built for every nurse on earth.
          </p>
          <button onClick={onEnterApp} className="btn-primary px-12 py-5 mx-auto text-[16px] shadow-[0_8px_40px_rgba(13,148,136,0.40)]">
            Open Handova <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* ── Report History ── */}
      <div className="bg-[#06111E]">
        <ReportHistory />
      </div>

      {/* ── Footer ── */}
      <footer className="py-10 px-6 border-t bg-[#06111E] border-white/5">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg overflow-hidden">
              <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <rect width="48" height="48" rx="12" fill="#0D9488"/>
                <path d="M13 12h5v10h12V12h5v24h-5V27H18v9h-5V12z" fill="white" opacity="0.95"/>
              </svg>
            </div>
            <span className="font-display text-sm font-semibold text-slate-400">Handova</span>
          </div>
          <p className="text-xs text-slate-600 text-center">
            AI-Powered Nursing Shift Reports · © 2026 Handova · Born in Akure 🇳🇬 · Used worldwide 🌍
          </p>
          <p className="text-xs text-slate-700 font-mono">v11.0</p>
        </div>
      </footer>

    </div>
  );
}
