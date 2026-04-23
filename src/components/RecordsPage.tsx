/**
 * RecordsPage.tsx — Handova v10.5.1
 *
 * Unified records page — two tabs:
 *   - Shift Reports: completed nursing shift reports
 *   - Care Plans: saved shift planner outputs
 *
 * Each record shows date/time saved, can be opened, reviewed,
 * copied, or deleted. Styled distinctly for each type.
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useState, useEffect } from "react";
import {
  FileText, ClipboardList, Trash2, X, Copy, Check,
  Clock, AlertTriangle, ChevronRight, History, Calendar,
  Activity, Pill, Stethoscope, FlaskConical, Heart,
  MessageSquare, BookOpen,
} from "lucide-react";
import {
  loadHistory, deleteHistoryEntry,
  loadPlannerHistory, deletePlannerEntry,
} from "../utils/storage";
import type { HistoryEntry, PlannerHistoryEntry } from "../utils/storage";
import { formatDate } from "../utils/reportFormatter";

function formatSavedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-NG", {
      weekday: "short", day: "2-digit", month: "short",
      year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-NG", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  MEDICATION: <Pill size={10} />,
  MONITORING: <Activity size={10} />,
  ASSESSMENT: <Stethoscope size={10} />,
  INVESTIGATION: <FlaskConical size={10} />,
  COMFORT: <Heart size={10} />,
  COMMUNICATION: <MessageSquare size={10} />,
  EDUCATION: <BookOpen size={10} />,
};

const PRIORITY_COLOURS: Record<string, string> = {
  URGENT: "text-red-600 bg-red-50 border-red-200",
  HIGH: "text-amber-600 bg-amber-50 border-amber-200",
  ROUTINE: "text-teal-600 bg-teal-50 border-teal-200",
  PRN: "text-slate-500 bg-slate-50 border-slate-200",
};

// ─── REPORT VIEWER MODAL ─────────────────────────────────────────────────────

function ReportModal({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(entry.report); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = entry.report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[88vh] flex flex-col bg-white rounded-2xl shadow-2xl fade-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-teal-50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center">
              <FileText size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-teal-900">
                {entry.ward} — {entry.shift} Shift
              </p>
              <p className="text-[10px] text-teal-700 mt-0.5">
                {formatDate(entry.date)} · {entry.patientCount} patient{entry.patientCount !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied!" : "Copy report"}
            </button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
        {/* Body */}
        <div className="overflow-y-auto p-6 flex-1 bg-white">
          <pre className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
            {entry.report}
          </pre>
        </div>
        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <Clock size={11} className="text-slate-400" />
            <p className="text-[10px] text-slate-400">Saved {formatSavedAt(entry.savedAt)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PLANNER VIEWER MODAL ─────────────────────────────────────────────────────

function PlannerModal({ entry, onClose }: { entry: PlannerHistoryEntry; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [noteCopied, setNoteCopied] = useState(false);

  const handleCopyPlan = async () => {
    const text = [
      `NURSING SHIFT CARE PLAN`,
      `Patient: ${entry.patientName}`,
      `Diagnosis: ${entry.diagnosis}`,
      `Shift: ${entry.shiftStart} – ${entry.shiftEnd}`,
      `Ward: ${entry.ward}`,
      `Saved: ${formatSavedAt(entry.savedAt)}`,
      "",
      `SUMMARY:`,
      entry.plan.summary,
      "",
      `CARE PLAN:`,
      ...entry.plan.plan.map(i =>
        `${i.time} [${i.priority}] ${i.category}\n  → ${i.intervention}\n  Rationale: ${i.rationale}`
      ),
      "",
      `ESCALATION TRIGGERS:`,
      ...entry.plan.escalationTriggers.map(t => `• ${t}`),
      "",
      `END-OF-SHIFT NOTE:`,
      entry.plan.endOfShiftNote,
    ].join("\n");
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleCopyNote = async () => {
    try { await navigator.clipboard.writeText(entry.plan.endOfShiftNote); }
    catch {}
    setNoteCopied(true);
    setTimeout(() => setNoteCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[88vh] flex flex-col bg-white rounded-2xl shadow-2xl fade-up overflow-hidden">
        {/* Header — indigo for planner */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-indigo-100 bg-indigo-50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <ClipboardList size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-indigo-900">{entry.patientName || "Patient"}</p>
              <p className="text-[10px] text-indigo-700 mt-0.5">
                {entry.diagnosis ? entry.diagnosis.slice(0, 60) + (entry.diagnosis.length > 60 ? "…" : "") : "—"} · {entry.shiftStart}–{entry.shiftEnd}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyPlan}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied!" : "Copy plan"}
            </button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 bg-white divide-y divide-slate-100">
          {/* Summary */}
          <div className="px-6 py-4 bg-indigo-50/50">
            <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">Clinical Summary</p>
            <p className="text-xs text-indigo-900 leading-relaxed">{entry.plan.summary}</p>
          </div>

          {/* Interventions */}
          <div>
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-100">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Care Plan — {entry.plan.plan.length} interventions
              </p>
            </div>
            {entry.plan.plan.map((item, i) => (
              <div key={i} className="flex gap-3 px-6 py-3 border-b border-slate-50 hover:bg-slate-50/50">
                <div className="flex-shrink-0 w-10 text-center">
                  <p className="text-xs font-bold font-mono text-slate-600">{item.time}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${PRIORITY_COLOURS[item.priority] || "text-slate-500 bg-slate-50 border-slate-200"}`}>
                      {item.priority}
                    </span>
                    <span className="flex items-center gap-0.5 text-[9px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                      {CATEGORY_ICONS[item.category]}
                      {item.category}
                    </span>
                  </div>
                  <p className="text-xs text-slate-800 leading-relaxed">{item.intervention}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{item.rationale}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Escalation */}
          {entry.plan.escalationTriggers?.length > 0 && (
            <div className="px-6 py-4 bg-red-50/50">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={12} className="text-red-500" />
                <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider">Escalation Triggers</p>
              </div>
              {entry.plan.escalationTriggers.map((t, i) => (
                <p key={i} className="text-xs text-red-800 leading-relaxed mb-1">• {t}</p>
              ))}
            </div>
          )}

          {/* End of shift note */}
          {entry.plan.endOfShiftNote && (
            <div className="px-6 py-4 bg-teal-50/50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-teal-600 uppercase tracking-wider">End-of-Shift Note</p>
                <button
                  onClick={handleCopyNote}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-white border border-teal-200 text-teal-600 hover:bg-teal-50 transition-colors"
                >
                  {noteCopied ? <Check size={9} /> : <Copy size={9} />}
                  {noteCopied ? "Copied" : "Copy note"}
                </button>
              </div>
              <p className="text-xs text-teal-900 leading-relaxed">{entry.plan.endOfShiftNote}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <Clock size={11} className="text-slate-400" />
            <p className="text-[10px] text-slate-400">Saved {formatSavedAt(entry.savedAt)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN RECORDS PAGE ───────────────────────────────────────────────────────

interface RecordsPageProps {
  initialTab?: "reports" | "plans";
}

export default function RecordsPage({ initialTab = "reports" }: RecordsPageProps) {
  const [tab, setTab] = useState<"reports" | "plans">(initialTab);
  const [reports, setReports] = useState<HistoryEntry[]>([]);
  const [plans, setPlans] = useState<PlannerHistoryEntry[]>([]);
  const [selectedReport, setSelectedReport] = useState<HistoryEntry | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlannerHistoryEntry | null>(null);

  useEffect(() => {
    setReports(loadHistory());
    setPlans(loadPlannerHistory());
  }, []);

  const handleDeleteReport = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteHistoryEntry(id);
    setReports(loadHistory());
    if (selectedReport?.id === id) setSelectedReport(null);
  };

  const handleDeletePlan = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deletePlannerEntry(id);
    setPlans(loadPlannerHistory());
    if (selectedPlan?.id === id) setSelectedPlan(null);
  };

  const isEmpty = tab === "reports" ? reports.length === 0 : plans.length === 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="fade-up">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
            <History size={14} className="text-slate-600" />
          </div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Records</span>
        </div>
        <h1 className="font-display text-3xl font-semibold text-slate-900 mb-1">Your Records</h1>
        <p className="text-sm text-slate-500">
          All shift reports and care plans saved on this device. Tap any record to review or copy.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
        <button
          onClick={() => setTab("reports")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
            tab === "reports"
              ? "bg-white text-teal-700 shadow-sm border border-slate-200"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <FileText size={13} />
          Shift Reports
          {reports.length > 0 && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === "reports" ? "bg-teal-100 text-teal-700" : "bg-slate-200 text-slate-500"}`}>
              {reports.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("plans")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
            tab === "plans"
              ? "bg-white text-indigo-700 shadow-sm border border-slate-200"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <ClipboardList size={13} />
          Care Plans
          {plans.length > 0 && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === "plans" ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-500"}`}>
              {plans.length}
            </span>
          )}
        </button>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${tab === "reports" ? "bg-teal-50" : "bg-indigo-50"}`}>
            {tab === "reports"
              ? <FileText size={20} className="text-teal-400" />
              : <ClipboardList size={20} className="text-indigo-400" />
            }
          </div>
          <p className="text-sm font-semibold text-slate-600 mb-1">
            No {tab === "reports" ? "shift reports" : "care plans"} yet
          </p>
          <p className="text-xs text-slate-400">
            {tab === "reports"
              ? "Complete a shift report and it will appear here."
              : "Generate a shift care plan and save it — it will appear here."
            }
          </p>
        </div>
      )}

      {/* REPORTS list */}
      {tab === "reports" && reports.length > 0 && (
        <div className="space-y-2">
          {reports.map(entry => (
            <div
              key={entry.id}
              onClick={() => setSelectedReport(entry)}
              className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 cursor-pointer hover:border-teal-300 hover:shadow-sm transition-all duration-200 group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Teal accent for reports */}
                  <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center flex-shrink-0">
                    <FileText size={13} className="text-teal-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {entry.ward || "Unknown ward"} — {entry.shift || "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex items-center gap-1">
                        <Calendar size={9} className="text-slate-400" />
                        <p className="text-[10px] text-slate-500">{formatDate(entry.date)}</p>
                      </div>
                      <span className="text-slate-300">·</span>
                      <p className="text-[10px] text-slate-500">
                        {entry.patientCount} patient{entry.patientCount !== 1 ? "s" : ""}
                      </p>
                      <span className="text-slate-300">·</span>
                      <div className="flex items-center gap-1">
                        <Clock size={9} className="text-slate-400" />
                        <p className="text-[10px] text-slate-400">{formatShortDate(entry.savedAt)}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  <ChevronRight size={13} className="text-slate-300 group-hover:text-teal-500 transition-colors" />
                  <button
                    onClick={e => handleDeleteReport(entry.id, e)}
                    className="p-1.5 text-slate-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PLANS list */}
      {tab === "plans" && plans.length > 0 && (
        <div className="space-y-2">
          {plans.map(entry => (
            <div
              key={entry.id}
              onClick={() => setSelectedPlan(entry)}
              className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all duration-200 group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Indigo accent for plans */}
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center flex-shrink-0">
                    <ClipboardList size={13} className="text-indigo-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {entry.patientName || "Unknown patient"}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate mt-0.5 max-w-[200px]">
                      {entry.diagnosis || "—"}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {entry.shiftStart && entry.shiftEnd && (
                        <>
                          <div className="flex items-center gap-1">
                            <Clock size={9} className="text-indigo-400" />
                            <p className="text-[10px] text-indigo-600 font-medium">
                              {entry.shiftStart} – {entry.shiftEnd}
                            </p>
                          </div>
                          <span className="text-slate-300">·</span>
                        </>
                      )}
                      <p className="text-[10px] text-slate-400">{formatShortDate(entry.savedAt)}</p>
                      <span className="text-slate-300">·</span>
                      <p className="text-[10px] text-indigo-500 font-medium">
                        {entry.plan.plan.length} interventions
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  <ChevronRight size={13} className="text-slate-300 group-hover:text-indigo-500 transition-colors" />
                  <button
                    onClick={e => handleDeletePlan(entry.id, e)}
                    className="p-1.5 text-slate-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {selectedReport && (
        <ReportModal entry={selectedReport} onClose={() => setSelectedReport(null)} />
      )}
      {selectedPlan && (
        <PlannerModal entry={selectedPlan} onClose={() => setSelectedPlan(null)} />
      )}
    </div>
  );
}
