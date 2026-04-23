import { useState } from "react";
import { ArrowRight, ArrowLeft } from "lucide-react";

type TooltipPosition = "center" | "bottom";

interface OnboardingStep {
  title: string;
  desc: string;
  target: string | null;
  position: TooltipPosition;
}

const STEPS: OnboardingStep[] = [
  {
    title: "Welcome to Handova",
    desc: "Generate professional nursing shift reports in under 5 minutes. Let's walk you through the 3-step process.",
    target: null,
    position: "center",
  },
  {
    title: "Step 1 — Shift Information",
    desc: "Start by selecting your ward, shift type, and date. Then fill in the patient flow numbers — Handova calculates the handover count automatically.",
    target: "step-0",
    position: "bottom",
  },
  {
    title: "Step 2 — Patient Details",
    desc: "Add each patient one by one. Select how they arrived this shift — this determines how the AI opens their nurse's note.",
    target: "step-1",
    position: "bottom",
  },
  {
    title: "Speak Your Shift Events",
    desc: "Tap 'Speak shift events' and talk through what happened — condition on takeover, interventions, doctor's review, medications. The AI handles the rest.",
    target: "step-1",
    position: "bottom",
  },
  {
    title: "Step 3 — Full Report",
    desc: "Your complete shift report assembles automatically. Review it, make any edits, then copy and paste directly into Medikal HMS.",
    target: "step-2",
    position: "bottom",
  },
  {
    title: "Full guide inside About",
    desc: "Tap the ℹ️ About button in the top right anytime to open the full How to Use guide — covering Quick Mode, Voice, SBAR, Settings, and more.",
    target: null,
    position: "center",
  },
];

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(true);

  const isCenter = STEPS[step].position === "center";

  const handleComplete = () => {
    localStorage.setItem("handova_onboarded", "1");
    setVisible(false);
    onComplete?.();
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else handleComplete();
  };

  const prev = () => { if (step > 0) setStep(s => s - 1); };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none">
      {/* Overlay */}
      <div className="absolute inset-0 bg-[#010C1A]/80 backdrop-blur-sm pointer-events-auto" onClick={handleComplete} />

      {/* Tooltip card */}
      <div className={`absolute pointer-events-auto ${isCenter ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" : "bottom-24 left-1/2 -translate-x-1/2"} w-full max-w-sm px-4`}>
        <div className="glass rounded-2xl p-6 border border-teal-500/30 shadow-2xl fade-up">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mb-5">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-teal-400" : i < step ? "w-3 bg-teal-700" : "w-3 bg-slate-700"}`} />
            ))}
          </div>

          <h3 className="font-display text-lg font-semibold text-white mb-2">{STEPS[step].title}</h3>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">{STEPS[step].desc}</p>

          <div className="flex items-center justify-between">
            <button onClick={handleComplete} className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button onClick={prev} className="btn-secondary text-xs px-3 py-2">
                  <ArrowLeft size={13} />
                </button>
              )}
              <button onClick={next} className="btn-primary text-xs px-4 py-2">
                {step === STEPS.length - 1 ? "Get started" : "Next"}
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function shouldShowOnboarding() {
  return !localStorage.getItem("handova_onboarded");
}
