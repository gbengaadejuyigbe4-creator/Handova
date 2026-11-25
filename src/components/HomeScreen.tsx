import { useMemo } from "react";
import { ClipboardList, FileText, History, ArrowRight } from "lucide-react";
import { loadHistory, loadPlannerHistory } from "../utils/storage";
import { getNextStep, type NextStep } from "../utils/nextStep";
import type { AppRoute } from "../utils/route";

interface HomeScreenProps {
  onNavigate: (route: AppRoute) => void;
  /** Lets tests and callers fix the suggestion; normally worked out from saved history. */
  nextStep?: NextStep;
}

interface ToolCardProps {
  moment: string;
  name: string;
  body: string;
  action: string;
  icon: typeof ClipboardList;
  suggested: boolean;
  onOpen: () => void;
}

function ToolCard({ moment, name, body, action, icon: Icon, suggested, onOpen }: ToolCardProps) {
  return (
    <section
      aria-label={`${moment}: ${name}`}
      className={
        "bg-[var(--surface-1)] rounded-lg p-5 flex flex-col " +
        (suggested ? "border-2 border-teal-600 dark:border-teal-400" : "border border-[var(--border-strong)]")
      }
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-bold text-teal-700 dark:text-teal-300 flex items-center gap-2">
          <Icon size={18} aria-hidden="true" />
          {moment}
        </p>
        {suggested && <span className="text-sm font-bold text-teal-800 dark:text-teal-300">Suggested next</span>}
      </div>
      <h2 className="font-display text-[24px] mb-2">{name}</h2>
      <p className="text-[15px] text-slate-700 dark:text-slate-300 leading-relaxed mb-5 flex-1">{body}</p>
      <button onClick={onOpen} className={suggested ? "btn-primary w-full" : "btn-secondary w-full"}>
        {action} <ArrowRight size={16} aria-hidden="true" />
      </button>
    </section>
  );
}

export default function HomeScreen({ onNavigate, nextStep }: HomeScreenProps) {
  const next = useMemo<NextStep>(
    () => nextStep ?? getNextStep(loadPlannerHistory(), loadHistory()),
    [nextStep],
  );

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <h1 className="font-display text-3xl font-semibold mb-1">Your shift</h1>
        <p className="text-sm text-slate-600">Plan the shift when it starts. Write the handover report when it ends.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <ToolCard
          moment="Start of shift"
          name="Shift planner"
          body="Upload each patient's record as a PDF. Get risk flags, a nursing care plan and a handover brief for the ward."
          action="Open shift planner"
          icon={ClipboardList}
          suggested={next === "planner"}
          onOpen={() => onNavigate("planner")}
        />
        <ToolCard
          moment="End of shift"
          name="Handover report"
          body="Enter the shift details and each patient, by voice or typing. Check the drafted report, then paste it into your hospital system."
          action="Open handover report"
          icon={FileText}
          suggested={next === "report"}
          onOpen={() => onNavigate("report")}
        />
      </div>

      <div className="border-t border-[var(--border-subtle)] pt-4 flex items-center justify-between gap-4">
        <p className="text-[15px] text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <History size={18} aria-hidden="true" />
          Past reports and care plans are in Records.
        </p>
        <button onClick={() => onNavigate("records")} className="btn-secondary whitespace-nowrap">
          Open Records
        </button>
      </div>
    </div>
  );
}
