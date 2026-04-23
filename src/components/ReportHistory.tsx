/**
 * ReportHistory
 *
 * Displays the last 5 completed shifts on the landing page.
 * Each entry shows ward, shift, date, patient count.
 * Tapping an entry opens the full report text in a modal for copy/print.
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useState, useEffect } from "react";
import { Clock, X, Copy, Check, Trash2, History } from "lucide-react";
import { loadHistory, deleteHistoryEntry } from "../utils/storage";
import { formatDate } from "../utils/reportFormatter";
import type { HistoryEntry } from "../utils/storage";

export default function ReportHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEntries(loadHistory());
  }, []);

  if (entries.length === 0) return null;

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteHistoryEntry(id);
    setEntries(loadHistory());
    if (selected?.id === id) setSelected(null);
  };

  const handleCopy = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.report);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = selected.report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const savedAt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-NG", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <section className="py-16 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
            <History size={15} className="text-teal-400" />
          </div>
          <div>
            <p className="section-label">Recent Shifts</p>
            <p className="text-xs text-slate-600 mt-0.5">Last {entries.length} completed report{entries.length !== 1 ? "s" : ""} — saved on this device</p>
          </div>
        </div>

        <div className="space-y-2">
          {entries.map(entry => (
            <div
              key={entry.id}
              onClick={() => setSelected(entry)}
              className="card cursor-pointer hover:border-teal-500/30 transition-all duration-200 group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex-shrink-0 text-center">
                    <p className="text-xs text-slate-600 uppercase tracking-wider">{entry.shift || "—"}</p>
                    <p className="text-sm font-semibold text-white">{formatDate(entry.date)}</p>
                  </div>
                  <div className="w-px h-8 bg-white/8 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{entry.ward || "Unknown ward"}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {entry.patientCount} patient{entry.patientCount !== 1 ? "s" : ""} · saved {savedAt(entry.savedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  <span className="text-xs text-teal-600 group-hover:text-teal-400 transition-colors hidden sm:block">View report</span>
                  <button
                    onClick={(e) => handleDelete(entry.id, e)}
                    className="p-1.5 text-slate-700 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Report modal */}
      {selected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-[#010C1A]/90 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="relative w-full max-w-3xl max-h-[85vh] flex flex-col glass rounded-2xl border border-white/10 shadow-2xl fade-up">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/8 flex-shrink-0">
              <div>
                <p className="text-sm font-semibold text-white">
                  {selected.ward} — {selected.shift} Shift
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{formatDate(selected.date)} · {selected.patientCount} patient{selected.patientCount !== 1 ? "s" : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className={`btn-primary text-xs px-4 py-2 ${copied ? "bg-teal-700" : ""}`}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button onClick={() => setSelected(null)} className="p-2 text-slate-500 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>
            {/* Report text */}
            <div className="overflow-y-auto p-6 flex-1">
              <pre className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap font-mono">
                {selected.report}
              </pre>
            </div>
            <div className="px-6 py-3 border-t border-white/5 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <Clock size={11} className="text-slate-600" />
                <p className="text-xs text-slate-600">Saved {savedAt(selected.savedAt)}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
