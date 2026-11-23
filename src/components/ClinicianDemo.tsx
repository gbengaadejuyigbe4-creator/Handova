/**
 * ClinicianDemo.tsx
 *
 * A clickable DEMO of the clinician dashboard, built on invented patients (src/demo).
 * Nothing is saved or sent anywhere. It exists to get feedback from medical officers on
 * what a doctor would want to see on a ward round. Open it at /#clinician-demo.
 *
 * Principles shown here:
 *   - every AI perspective is a suggestion and always shows its disclaimer
 *   - nurses can read perspectives; only the doctor view can accept, defer or reject
 *   - a reason is never required
 *   - nothing becomes an order or a task
 *   - every fact shows its source and whether a nurse verified it
 */

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  DEMO_PATIENTS,
  type DemoFact,
  type DemoGap,
  type DemoItem,
  type DemoPatient,
  type Coverage,
  type DemoPerspective,
  type FactRef,
  type GapState,
  type NextStep,
  type Urgency,
} from "../demo/clinicianDemoData";

export type Role = "doctor" | "nurse";
export type Decision = "accepted" | "deferred" | "rejected";
export interface DecisionRecord { decision: Decision; reason: string }

const DEMO_DOCTOR = "Dr Demo (medical officer)";

const GAP_LABEL: Record<GapState, string> = {
  not_documented: "Not documented",
  ordered_not_completed: "Ordered, not completed",
  completed_pending: "Done, result pending",
  completed_available: "Result available",
  possibly_elsewhere: "May exist elsewhere",
  not_ordered_consider: "Not ordered, worth considering",
};

const NEXT_LABEL: Record<NextStep, string> = {
  locate_existing: "Locate an existing result",
  clarify_record: "Clarify the record",
  complete_ordered: "Complete an ordered test",
  consider_new: "Consider a new assessment or test",
};

const URGENCY_STYLE: Record<Urgency, string> = {
  urgent: "bg-red-100 text-red-800 border-red-200",
  soon: "bg-amber-100 text-amber-800 border-amber-200",
  routine: "bg-slate-100 text-slate-700 border-slate-200",
};

const DECISION_LABEL: Record<Decision, string> = {
  accepted: "Accepted",
  deferred: "Deferred",
  rejected: "Rejected (not adopted)",
};

function Chips({ basis, facts }: { basis: string[]; facts: FactRef[] }) {
  if (basis.length === 0) {
    return <span className="text-[10px] text-slate-400">general medical knowledge</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {basis.map((id) => {
        const f = facts.find((x) => x.id === id);
        if (!f) return null;
        return (
          <span key={id} title={`${f.label}: ${f.value}`} className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
            {f.label}
          </span>
        );
      })}
    </span>
  );
}

const COVERAGE_LABEL: Partial<Record<Coverage, { text: string; style: string }>> = {
  in_plan: { text: "Already in the documented plan", style: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  partly_in_plan: { text: "Partly in the documented plan", style: "bg-amber-50 text-amber-800 border-amber-200" },
  not_in_plan: { text: "Not found in the documented plan", style: "bg-indigo-600 text-white border-indigo-700" },
};

function CoverageBadge({ coverage }: { coverage?: Coverage }) {
  const c = coverage ? COVERAGE_LABEL[coverage] : undefined;
  if (!c) return null;
  return (
    <span title="Judged from this record only. The plan may exist elsewhere." className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${c.style}`}>
      {c.text}
    </span>
  );
}

/** Counts the suggestions the documented plan does not cover. */
export function countNotInPlan(p: DemoPerspective): number {
  if (typeof p.notInPlanCount === "number") return p.notInPlanCount;
  const items = [...p.monitoring, ...p.management, ...p.escalation];
  return [...items, ...p.evidenceGaps].filter((x) => x.coverage === "not_in_plan").length;
}

function UnverifiedNote({ figures }: { figures?: string[] }) {
  if (!figures || figures.length === 0) return null;
  return (
    <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 leading-relaxed">
      Figures not found in the record: {figures.join(", ")}. Verify before relying on this.
    </p>
  );
}

function ItemList({ title, items, facts, open = false }: { title: string; items: DemoItem[]; facts: FactRef[]; open?: boolean }) {
  if (items.length === 0) return null;
  return (
    <details open={open} className="rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">{title}</summary>
      <ul className="px-3 pb-3 space-y-2">
        {items.map((it, i) => (
          <li key={i} className="text-sm text-slate-800 leading-relaxed">
            <CoverageBadge coverage={it.coverage} />
            <p>{it.text}</p>
            <Chips basis={it.basis} facts={facts} />
            <UnverifiedNote figures={it.unverifiedNumbers} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function GapCard({ gap, facts }: { gap: DemoGap; facts: FactRef[] }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-slate-800">{gap.missing}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white border border-slate-300 text-slate-700">{GAP_LABEL[gap.state]}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${URGENCY_STYLE[gap.urgency]}`}>{gap.urgency}</span>
        <CoverageBadge coverage={gap.coverage} />
      </div>
      <p className="text-xs text-slate-700"><b>Why it may matter:</b> {gap.why}</p>
      <p className="text-xs text-slate-700"><b>Limits interpretation:</b> {gap.limitation}</p>
      <p className="text-xs text-slate-700">
        <b>Possible next step:</b> {NEXT_LABEL[gap.nextStep]}
        {gap.needsClinicianDecision ? " (needs a clinician's decision)" : ""}
      </p>
      <Chips basis={gap.basis} facts={facts} />
      <UnverifiedNote figures={gap.unverifiedNumbers} />
    </li>
  );
}

export function PerspectiveCard({
  p,
  facts,
  role,
  decision,
  onDecide,
  onUndo,
}: {
  p: DemoPerspective;
  facts: FactRef[];
  /** "viewer" = real patient screen without sign-in: read-only, nothing is recorded. */
  role: Role | "viewer";
  decision?: DecisionRecord;
  onDecide?: (d: Decision, reason: string) => void;
  onUndo?: () => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <article className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-indigo-700 ">{p.specialtyLabel}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 ">
            AI-generated suggestion
          </span>
        </div>
        <h3 className="text-base font-semibold text-slate-900 leading-snug">{p.headline}</h3>
        {countNotInPlan(p) > 0 && (
          <p className="text-[11px] font-semibold text-indigo-700">
            {countNotInPlan(p)} suggestion{countNotInPlan(p) === 1 ? "" : "s"} not found in the documented plan
          </p>
        )}
      </header>

      <div role="note" data-testid="disclaimer" className="text-[11px] font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
        {p.disclaimer}
      </div>

      {[...p.monitoring, ...p.management, ...p.escalation, ...p.evidenceGaps].some((x) => x.coverage && x.coverage !== "unknown") && (
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Plan status is judged from this record only. “Not found” does not mean “not planned”: the plan may exist elsewhere.
        </p>
      )}

      <ItemList title="What the record could suggest" items={p.interpretations} facts={facts} open />

      {p.evidenceGaps.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700">Evidence gaps, most consequential first</h4>
          <ul className="space-y-2">
            {p.evidenceGaps.map((g, i) => <GapCard key={i} gap={g} facts={facts} />)}
          </ul>
        </section>
      )}

      <ItemList title="Differentials to consider" items={p.differentials} facts={facts} />
      <ItemList title="Possible complications and risks" items={p.risks} facts={facts} />
      <ItemList title="Monitoring considerations" items={p.monitoring} facts={facts} />
      <ItemList title="Management considerations" items={p.management} facts={facts} />
      <ItemList title="Possible escalation or referral" items={p.escalation} facts={facts} />

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">Limitations</summary>
        <ul className="px-3 pb-3 list-disc list-inside text-xs text-slate-700 space-y-1">
          {p.limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </details>

      <footer className="pt-2 border-t border-slate-100 space-y-2">
        {decision ? (
          <div className="text-sm text-slate-800">
            <p><b>Reviewed by {DEMO_DOCTOR}:</b> {DECISION_LABEL[decision.decision]}</p>
            {decision.reason && <p className="text-xs text-slate-600">Reason: {decision.reason}</p>}
            {role === "doctor" && onUndo && (
              <button onClick={onUndo} className="mt-1 text-xs text-indigo-700 underline">Undo</button>
            )}
          </div>
        ) : role === "doctor" ? (
          <div className="space-y-2">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional, never required)"
              className="w-full text-sm rounded-lg border border-slate-300 px-3 py-2"
              rows={2}
            />
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => onDecide?.("accepted", reason)} className="rounded-lg bg-emerald-600 text-white text-sm font-semibold py-2.5">Accept</button>
              <button onClick={() => onDecide?.("deferred", reason)} className="rounded-lg bg-slate-200 text-slate-800 text-sm font-semibold py-2.5">Defer</button>
              <button onClick={() => onDecide?.("rejected", reason)} className="rounded-lg bg-white border border-slate-300 text-slate-800 text-sm font-semibold py-2.5">Reject</button>
            </div>
            <p className="text-[11px] text-slate-500">You may also ignore this suggestion. Nothing here becomes an order or a task.</p>
          </div>
        ) : role === "viewer" ? (
          <p className="text-sm text-slate-700">
            <b>Read-only here.</b> Medical personnel review these suggestions. Recording decisions will come with sign-in.
          </p>
        ) : (
          <p className="text-sm text-slate-700">
            <b>Awaiting medical review.</b> Nurses can read this suggestion. Medical personnel review it.
          </p>
        )}
      </footer>
    </article>
  );
}

function FactRow({ f }: { f: DemoFact }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm text-slate-900"><b>{f.label}:</b> {f.value}</p>
        <p className="text-[11px] text-slate-500">{f.source} · {f.time}</p>
      </div>
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${f.verification === "nurse_verified" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
        {f.verification === "nurse_verified" ? "Nurse-verified" : "Unverified"}
      </span>
    </li>
  );
}

export default function ClinicianDemo() {
  const [role, setRole] = useState<Role>("doctor");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, DecisionRecord>>({});

  const patient: DemoPatient | undefined = DEMO_PATIENTS.find((p) => p.id === patientId);
  const pending = (p: DemoPatient) => p.perspectives.filter((x) => !decisions[x.id]).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        <div role="alert" className="rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold px-3 py-2">
          DEMO. Invented patients. Nothing is saved or sent anywhere. For design feedback only.
        </div>

        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">Handova · Clinician view</h1>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-semibold">
            <button onClick={() => setRole("doctor")} className={`px-3 py-1.5 ${role === "doctor" ? "bg-indigo-600 text-white" : "bg-white text-slate-700"}`}>Doctor view</button>
            <button onClick={() => setRole("nurse")} className={`px-3 py-1.5 ${role === "nurse" ? "bg-indigo-600 text-white" : "bg-white text-slate-700"}`}>Nurse view</button>
          </div>
        </div>

        {!patient && (
          <section className="space-y-3">
            <p className="text-sm text-slate-600">
              {role === "doctor" ? "Patients with suggestions awaiting your review." : "Patients on the ward. Suggestions are read-only for nurses."}
            </p>
            {DEMO_PATIENTS.map((p) => (
              <button key={p.id} onClick={() => setPatientId(p.id)} className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="font-semibold">{p.label} · {p.age} · {p.sex}</p>
                <p className="text-sm text-slate-600">{p.diagnosis}</p>
                <p className="mt-1 text-xs font-semibold text-indigo-700">
                  {pending(p)} of {p.perspectives.length} {role === "doctor" ? "awaiting your review" : "awaiting medical review"}
                </p>
              </button>
            ))}
          </section>
        )}

        {patient && (
          <section className="space-y-4">
            <button onClick={() => setPatientId(null)} className="inline-flex items-center gap-1 text-sm text-indigo-700">
              <ArrowLeft size={14} /> All patients
            </button>
            <div>
              <h2 className="text-xl font-bold">{patient.label} · {patient.age} · {patient.sex}</h2>
              <p className="text-sm text-slate-600">{patient.diagnosis}</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              <h3 className="text-xs font-semibold text-slate-700">Since the last review</h3>
              <ul className="list-disc list-inside text-sm text-slate-800 space-y-1">
                {patient.changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
              <p className="text-[11px] text-slate-500">Safety alerts are a separate, rule-based pathway and are not part of these suggestions. None in this demo.</p>
            </div>

            <div className="space-y-4">
              {patient.perspectives.map((p) => (
                <PerspectiveCard
                  key={p.id}
                  p={p}
                  facts={patient.facts}
                  role={role}
                  decision={decisions[p.id]}
                  onDecide={(d, reason) => setDecisions((prev) => ({ ...prev, [p.id]: { decision: d, reason: reason.trim() } }))}
                  onUndo={() => setDecisions((prev) => { const next = { ...prev }; delete next[p.id]; return next; })}
                />
              ))}
            </div>

            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">Record facts, with source and verification</summary>
              <ul className="px-3 pb-2">{patient.facts.map((f) => <FactRow key={f.id} f={f} />)}</ul>
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
