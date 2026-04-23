/**
 * ReportOutput.tsx — Handova v11.0
 * Premium clinical document output with time-saved counter,
 * proper document layout, and copy/print actions.
 */
import { useState, useEffect, useRef } from "react";
import {
  Copy, Check, FileText, Printer, Sparkles,
  Clock, TrendingUp, ChevronDown,
} from "lucide-react";
import { buildStructuredReport, FORMAT_LABELS, type ReportFormat } from "../utils/reportFormatter";
import { getRegionConfig } from "../utils/regionConfig";
import type { AppSettings } from "../utils/settings";
import type { ShiftHeader, Patient } from "../types";

interface ReportOutputProps {
  header: ShiftHeader;
  patients: Patient[];
  lang?: string;
  settings?: AppSettings;
}

function TimeSavedBanner({ patientCount }: { patientCount: number }) {
  const [count, setCount] = useState(0);
  const target = Math.max(25, patientCount * 12);
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let current = 0;
    const step = Math.ceil(target / 40);
    ref.current = setInterval(() => {
      current = Math.min(current + step, target);
      setCount(current);
      if (current >= target) clearInterval(ref.current!);
    }, 30);
    return () => clearInterval(ref.current!);
  }, [target]);

  return (
    <div className="time-saved-banner fade-up">
      <div className="flex-shrink-0">
        <div className="time-saved-number">{count}</div>
        <div className="time-saved-label">minutes saved</div>
        <div className="time-saved-sub">vs manual writing</div>
      </div>
      <div className="w-px self-stretch bg-teal-200 mx-1" />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles size={13} className="text-teal-600" />
          <span className="text-xs font-bold text-teal-800">Report ready</span>
        </div>
        <p className="text-xs text-teal-700 leading-relaxed">
          Your shift report is complete and formatted for Medikal HMS. Review below, then copy and paste.
        </p>
        <div className="flex items-center gap-1.5 mt-2">
          <TrendingUp size={11} className="text-teal-500" />
          <span className="text-[11px] text-teal-600 font-semibold">
            {patientCount} patient{patientCount !== 1 ? "s" : ""} documented
          </span>
        </div>
      </div>
    </div>
  );
}

function ReportEmptyState() {
  return (
    <div className="empty-state border border-dashed border-slate-200 rounded-2xl bg-white">
      <div className="empty-state-icon bg-slate-50" style={{ boxShadow: '0 4px 20px rgba(12,27,46,0.06)' }}>
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" className="relative z-10">
          <rect x="6" y="4" width="24" height="28" rx="3" fill="#E2EEF4" stroke="#CBD5E1" strokeWidth="1.5"/>
          <rect x="10" y="10" width="16" height="2" rx="1" fill="#94A3B8"/>
          <rect x="10" y="15" width="12" height="2" rx="1" fill="#CBD5E1"/>
          <rect x="10" y="20" width="14" height="2" rx="1" fill="#CBD5E1"/>
          <rect x="10" y="25" width="8" height="2" rx="1" fill="#CBD5E1"/>
          <circle cx="27" cy="27" r="7" fill="#14B8A6"/>
          <path d="M24 27l2 2 4-4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <p className="empty-state-title">Report assembles as you work</p>
      <p className="empty-state-desc">
        Generate a nurse's note for at least one patient. Your complete shift report will appear here, ready to copy into your HMS.
      </p>
    </div>
  );
}

export default function ReportOutput({ header, patients, settings }: ReportOutputProps) {
  const [copied, setCopied] = useState(false);
  const regionCfg = getRegionConfig(settings?.region || "ng");
  const availableFormats = regionCfg.formats as ReportFormat[];
  const [format, setFormat] = useState<ReportFormat>(settings?.defaultFormat || availableFormats[0] || "standard");
  const [showRaw, setShowRaw] = useState(false);

  const report = buildStructuredReport(header, patients, format, settings);

  const ready = patients.some((p) => p.noteReady || p.nursesNoteRaw);
  const generatedCount = patients.filter(p => p.noteReady).length;

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(report); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = report; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 3500);
  };

  const handlePrint = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head>
      <title>Handova — Shift Report</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        body { font-family: 'DM Sans', 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.75; padding: 40px; color: #1A2B3C; background: white; max-width: 800px; margin: 0 auto; }
        pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; }
        .header { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 2px solid #14B8A6; }
        .logo { width: 32px; height: 32px; background: #0D9488; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
        h1 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: #0D9488; margin: 0; }
        .meta { font-size: 11px; color: #607A93; margin-top: 2px; }
        @media print { body { padding: 20px; } }
      </style>
    </head><body>
      <div class="header">
        <div class="logo"><svg viewBox="0 0 48 48" width="20" height="20"><path d="M13 12h5v10h12V12h5v24h-5V27H18v9h-5V12z" fill="white"/></svg></div>
        <div><h1>Handova — Shift Report</h1><div class="meta">${header.ward || ''} · ${header.shift || ''} Shift · Generated ${new Date().toLocaleString('en-NG')}</div></div>
      </div>
      <pre>${report.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
      <script>window.onload=function(){window.print()}<\/script>
    </body></html>`);
    w.document.close();
  };

  return (
    <div className="fade-up space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="icon-container-teal">
            <FileText size={16} className="text-teal-600" />
          </div>
          <div>
            <p className="section-label">Shift Report</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {patients.length} patient{patients.length !== 1 ? "s" : ""}
              {generatedCount > 0 && ` · ${generatedCount} note${generatedCount !== 1 ? "s" : ""} generated`}
              {header.ward && ` · ${header.ward}`}
              {header.shift && ` · ${header.shift}`}
            </p>
          </div>
        </div>
        <button onClick={handlePrint}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all"
          style={{ background: 'var(--surface-2)', border: '1px solid rgba(12,27,46,0.09)', color: 'var(--text-secondary)' }}
          onMouseOver={e => (e.currentTarget.style.borderColor = 'rgba(20,184,166,0.3)')}
          onMouseOut={e => (e.currentTarget.style.borderColor = 'rgba(12,27,46,0.09)')}>
          <Printer size={13} /> Print
        </button>
      </div>

      {/* Format toggle */}
      <div className="flex items-center gap-3 rounded-xl px-4 py-3 flex-wrap"
        style={{ background: 'var(--surface-2)', border: '1px solid rgba(12,27,46,0.08)' }}>
        <div className="flex items-center gap-1.5">
          <Clock size={12} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Format</span>
        </div>
        <div className="flex items-center bg-white rounded-lg p-0.5 gap-0.5 border border-slate-200">
          {availableFormats.map((f) => (
            <button key={f} onClick={() => setFormat(f)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all duration-200 ${
                format === f
                  ? "bg-teal-500 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}>
              {FORMAT_LABELS[f]?.short || f.toUpperCase()}
            </button>
          ))}
        </div>
        {format !== "standard" && (
          <span className="text-xs font-medium" style={{ color: 'var(--teal-600)' }}>
            {FORMAT_LABELS[format]?.long}
          </span>
        )}
      </div>

      {!ready ? (
        <ReportEmptyState />
      ) : (
        <>
          <TimeSavedBanner patientCount={patients.length} />

          {/* Document */}
          <div className="report-document">
            {/* Document toolbar */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-teal-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-teal-300" />
                <div className="w-2.5 h-2.5 rounded-full bg-teal-100" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  {format === "standard" ? "shift_report.txt" : `shift_report_${format}.txt`}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: '#DCFCE7', color: '#14532D', border: '1px solid #86EFAC' }}>
                  Ready
                </span>
              </div>
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="flex items-center gap-1 text-xs font-medium transition-colors"
                style={{ color: 'var(--text-muted)' }}>
                {showRaw ? "Formatted" : "Plain text"}
                <ChevronDown size={11} className={`transition-transform ${showRaw ? "rotate-180" : ""}`} />
              </button>
            </div>

            {/* Report content */}
            <div className="p-6 overflow-auto" style={{ maxHeight: '62vh' }}>
              {showRaw ? (
                <pre className="text-xs leading-[1.85] whitespace-pre-wrap font-mono tracking-wide"
                  style={{ color: '#1A2B3C', fontFamily: "'JetBrains Mono', monospace" }}>
                  {report}
                </pre>
              ) : (
                <div className="report-document-inner space-y-5">
                  {report.split('\n\n').map((block, i) => {
                    if (!block.trim()) return null;
                    const isHeader = block.includes('SHIFT REPORT') || block.includes('SHIFT PATIENT FLOW');
                    const isPatientHeader = /^INPATIENT \d+/.test(block.trim());
                    const isNursesNote = block.startsWith("NURSES' NOTE");
                    return (
                      <div key={i}>
                        {isPatientHeader ? (
                          <div className="pt-4 pb-2 border-t border-slate-100">
                            <pre className="text-[13px] font-bold text-slate-800 whitespace-pre-wrap" style={{ fontFamily: 'inherit' }}>
                              {block}
                            </pre>
                          </div>
                        ) : isHeader ? (
                          <pre className="text-[13px] font-bold text-teal-800 whitespace-pre-wrap tracking-wide" style={{ fontFamily: 'inherit' }}>
                            {block}
                          </pre>
                        ) : isNursesNote ? (
                          <div>
                            <p className="text-[11px] font-bold text-teal-700 uppercase tracking-widest mb-1.5">Nurses' Note</p>
                            <pre className="text-[13.5px] text-slate-700 whitespace-pre-wrap leading-[1.85]" style={{ fontFamily: 'inherit' }}>
                              {block.replace("NURSES' NOTE\n", "")}
                            </pre>
                          </div>
                        ) : (
                          <pre className="text-[13px] text-slate-600 whitespace-pre-wrap leading-[1.8]" style={{ fontFamily: 'inherit' }}>
                            {block}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Copy button */}
          <div className="sticky bottom-4">
            <button
              onClick={handleCopy}
              className={`w-full flex items-center justify-center gap-3 py-4 rounded-xl font-bold text-base transition-all duration-300 ${
                copied
                  ? "text-white"
                  : "btn-primary btn-generate-idle"
              }`}
              style={copied ? {
                background: 'linear-gradient(135deg, #0A7A6F, #0D9488)',
                boxShadow: '0 4px 20px rgba(13,148,136,0.35)',
              } : {}}>
              {copied ? (
                <>
                  <span className="check-in inline-flex"><Check size={18} strokeWidth={3} /></span>
                  Report copied — paste into your HMS
                </>
              ) : (
                <>
                  <Copy size={16} />
                  Copy {format === "standard" ? "Full" : format.toUpperCase()} Report
                </>
              )}
            </button>
            {copied && (
              <p className="text-center text-xs mt-2 fade-in font-medium" style={{ color: 'var(--teal-600)' }}>
                Open your HMS and paste now (Ctrl+V / ⌘+V)
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
