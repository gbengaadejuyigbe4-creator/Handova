/**
 * QuickMode.tsx
 *
 * The new default entry point for Handova.
 *
 * The nurse dumps everything — messy, unstructured, however it comes out
 * of their head — into one text box (or speaks it). The AI extracts
 * structure, generates nurses' notes per patient, and produces a complete
 * HMS-ready report. No required fields. No gates. Zero friction.
 *
 * Three sub-modes:
 *   1. Type — large textarea, paste or type anything
 *   2. Voice — tap mic, speak entire handover, auto-transcribes
 *   3. Continue — load last shift report, speak/type what changed
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useState, useRef, useCallback } from "react";
import {
  Zap, Mic, MicOff, Copy, Check, RotateCcw,
  ChevronDown, Sparkles, Clock, ArrowRight, X
} from "lucide-react";
import { generateFromRaw, generateFromChanges } from "../utils/claudeApi";
import { FORMAT_LABELS, type ReportFormat } from "../utils/reportFormatter";
import { getRegionConfig } from "../utils/regionConfig";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { loadHistory } from "../utils/storage";
import type { AppSettings } from "../utils/settings";

interface QuickModeProps {
  settings: AppSettings;
  onSwitchToStructured: () => void;
}

type SubMode = "type" | "voice" | "continue";

export default function QuickMode({ settings, onSwitchToStructured }: QuickModeProps) {
  const regionCfg = getRegionConfig(settings?.region || "ng");
  const availableFormats = regionCfg.formats as ReportFormat[];
  const [subMode, setSubMode] = useState<SubMode>("type");
  const [rawText, setRawText] = useState("");
  const [format, setFormat] = useState<ReportFormat>(settings.defaultFormat || availableFormats[0] || "standard");
  const [isGenerating, setIsGenerating] = useState(false);
  const [report, setReport] = useState("");
  const [patientsFound, setPatientsFound] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [changesText, setChangesText] = useState("");
  const [selectedHistory, setSelectedHistory] = useState<string>("");
  const history = loadHistory();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Voice input for main textarea ──────────────────────────────────────────
  const { listening, transcribing, error: voiceError, start: startVoice, stop: stopVoice } = useVoiceInput({
    onTranscript: (text) => setRawText(text),
    disabled: isGenerating,
  });

  // ── Voice input for "what changed" ─────────────────────────────────────────
  const { listening: changesListening, transcribing: changesTranscribing, start: startChangesVoice, stop: stopChangesVoice } = useVoiceInput({
    onTranscript: (text) => setChangesText(text),
    disabled: isGenerating,
  });

  const handleGenerate = useCallback(async () => {
    setError("");
    setReport("");
    setIsGenerating(true);

    try {
      if (subMode === "continue" && selectedHistory) {
        const result = await generateFromChanges({
          previousReport: selectedHistory,
          changesRaw: changesText,
          settings,
        });
        setReport(result);
        setPatientsFound((result.match(/INPATIENT\s+\d+/gi) || []).length || 1);
      } else {
        const result = await generateFromRaw({ rawText, format, settings });
        setReport(result.report);
        setPatientsFound(result.patientsFound);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }, [rawText, format, settings, subMode, selectedHistory, changesText]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleReset = () => {
    setReport("");
    setRawText("");
    setChangesText("");
    setError("");
    setPatientsFound(0);
    setSelectedHistory("");
  };

  const canGenerate = subMode === "continue"
    ? Boolean(selectedHistory && changesText.trim())
    : rawText.trim().length >= 20;

  // ── If report is ready, show report view ───────────────────────────────────
  if (report) {
    return (
      <div className="space-y-5 fade-up">
        {/* Success banner */}
        <div className="flex items-center gap-3 bg-teal-50 border border-teal-200 rounded-xl px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
            <Sparkles size={14} className="text-teal-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-teal-800">
              Report ready — {patientsFound} patient{patientsFound !== 1 ? "s" : ""} detected
            </p>
            <p className="text-xs text-teal-600 mt-0.5">Review below, then copy into your HMS</p>
          </div>
          <button onClick={handleReset} className="text-teal-500 hover:text-teal-700 transition-colors flex-shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Report document */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-teal-500" />
              <div className="w-2 h-2 rounded-full bg-slate-300" />
              <div className="w-2 h-2 rounded-full bg-slate-200" />
            </div>
            <p className="text-xs text-slate-500 font-mono">shift_report.txt</p>
            <div className="w-16" />
          </div>
          <div className="p-5 overflow-auto max-h-[55vh]">
            <pre className="text-xs text-slate-700 leading-[1.9] whitespace-pre-wrap font-mono tracking-wide">
              {report}
            </pre>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2">
          <button
            onClick={handleCopy}
            className={`w-full flex items-center justify-center gap-3 py-4 rounded-xl font-bold text-sm transition-all duration-300 ${
              copied
                ? "bg-teal-700 text-white"
                : "bg-teal-600 hover:bg-teal-700 text-white"
            }`}
          >
            {copied ? (
              <><Check size={18} strokeWidth={3} /> Report copied to clipboard</>
            ) : (
              <><Copy size={16} /> Copy full report</>
            )}
          </button>
          {copied && (
            <p className="text-center text-xs text-teal-600 fade-in">Paste into your HMS now</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 transition-colors"
            >
              <RotateCcw size={13} /> New report
            </button>
            <button
              onClick={onSwitchToStructured}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 transition-colors"
            >
              Fill in missing details <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 fade-up">

      {/* Mode switcher tabs */}
      <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
        {([
          { id: "type" as SubMode, icon: Zap, label: "Quick type" },
          { id: "voice" as SubMode, icon: Mic, label: "Voice" },
          { id: "continue" as SubMode, icon: Clock, label: "Continue shift" },
        ]).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setSubMode(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
              subMode === id
                ? "bg-white text-teal-700 shadow-sm border border-slate-200"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* ── QUICK TYPE MODE ── */}
      {subMode === "type" && (
        <div className="space-y-3">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              placeholder={`Dump your shift notes here — anything goes.\n\nExamples:\n"8 patients taken over. Bed 4 — male, HTN, BP 190/110, labetalol given, settled. Bed 7 female, pneumonia, SpO2 92% on 4L O2, doctor reviewed, continue antibiotics. Bed 2 discharged this morning..."\n\nNo structure needed. The AI figures it out.`}
              rows={10}
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-4 text-sm text-slate-800 leading-relaxed focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 resize-y placeholder:text-slate-400"
            />
            {rawText && (
              <button
                onClick={() => setRawText("")}
                className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {rawText.length > 0 && (
            <p className="text-xs text-slate-400 text-right">{rawText.length} characters</p>
          )}
        </div>
      )}

      {/* ── VOICE MODE ── */}
      {subMode === "voice" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-4 py-6 bg-slate-50 rounded-xl border border-slate-200">
            <button
              onClick={listening ? stopVoice : () => startVoice(rawText)}
              disabled={isGenerating || transcribing}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
                listening
                  ? "bg-red-500 hover:bg-red-600 scale-105 shadow-lg shadow-red-200"
                  : transcribing
                  ? "bg-teal-400 cursor-wait"
                  : "bg-teal-600 hover:bg-teal-700 hover:scale-105 shadow-md"
              }`}
            >
              {listening ? (
                <MicOff size={28} className="text-white" />
              ) : (
                <Mic size={28} className="text-white" />
              )}
            </button>
            <div className="text-center">
              {listening && (
                <div className="flex items-center gap-1.5 text-red-500 text-sm font-medium">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Recording — pause 1.5s to stop
                </div>
              )}
              {transcribing && (
                <p className="text-teal-600 text-sm font-medium">Transcribing…</p>
              )}
              {!listening && !transcribing && (
                <p className="text-slate-500 text-sm">
                  Tap to start recording your handover
                </p>
              )}
            </div>
            <p className="text-xs text-slate-400 text-center max-w-[260px] leading-relaxed">
              Speak your full handover — ward, all patients, vitals, events, discharges. Say everything.
            </p>
          </div>

          {(voiceError) && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {voiceError}
            </p>
          )}

          {rawText && (
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-slate-600">Transcribed notes</p>
                <button onClick={() => setRawText("")} className="text-slate-400 hover:text-slate-600">
                  <X size={13} />
                </button>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed">{rawText}</p>
            </div>
          )}
        </div>
      )}

      {/* ── CONTINUE SHIFT MODE ── */}
      {subMode === "continue" && (
        <div className="space-y-4">
          {history.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <Clock size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No previous shift reports found.</p>
              <p className="text-xs mt-1">Generate a report first, then come back here.</p>
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wider">Select previous shift</p>
                <div className="space-y-2">
                  {history.slice(0, 3).map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => setSelectedHistory(entry.report)}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 ${
                        selectedHistory === entry.report
                          ? "border-teal-400 bg-teal-50"
                          : "border-slate-200 bg-white hover:border-teal-300"
                      }`}
                    >
                      <p className="text-sm font-medium text-slate-800">
                        {entry.ward || "—"} · {entry.shift || "—"}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {entry.patientCount} patients · {new Date(entry.savedAt).toLocaleDateString()}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {selectedHistory && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    What changed this shift?
                  </p>
                  <div className="relative">
                    <textarea
                      value={changesText}
                      onChange={e => setChangesText(e.target.value)}
                      placeholder="Speak or type what changed — new patients, discharges, vitals updates, doctor reviews, any events that happened..."
                      rows={5}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 leading-relaxed focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 resize-y placeholder:text-slate-400"
                    />
                  </div>
                  <button
                    onClick={changesListening ? stopChangesVoice : () => startChangesVoice(changesText)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                      changesListening
                        ? "bg-red-100 text-red-600 border border-red-200"
                        : "bg-slate-100 text-slate-600 border border-slate-200 hover:border-teal-300 hover:text-teal-600"
                    }`}
                  >
                    {changesListening ? <MicOff size={13} /> : <Mic size={13} />}
                    {changesListening ? "Stop recording" : "Speak changes"}
                    {changesTranscribing && <span className="text-teal-600">Transcribing…</span>}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Format toggle */}
      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-slate-700">
            {FORMAT_LABELS[format]?.short || format.toUpperCase()} format
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {FORMAT_LABELS[format]?.long || format.toUpperCase()}
          </p>
        </div>
        <div className="flex items-center bg-slate-200 rounded-lg p-0.5 gap-0.5 flex-shrink-0 ml-4">
          {availableFormats.map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 ${
                format === f ? "bg-teal-500 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {FORMAT_LABELS[f]?.short || f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || !canGenerate}
        className={`w-full flex items-center justify-center gap-2.5 py-4 rounded-xl font-bold text-sm transition-all duration-200 ${
          isGenerating
            ? "bg-teal-100 text-teal-400 cursor-not-allowed border border-teal-200"
            : canGenerate
            ? "bg-teal-600 hover:bg-teal-700 text-white shadow-sm hover:shadow-md"
            : "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
        }`}
      >
        {isGenerating ? (
          <>
            <span className="w-4 h-4 rounded-full border-2 border-teal-400 border-t-transparent animate-spin" />
            Generating report…
          </>
        ) : (
          <>
            <Sparkles size={16} />
            Generate shift report
          </>
        )}
      </button>

      {!canGenerate && !isGenerating && subMode === "type" && (
        <p className="text-center text-xs text-slate-400">
          Add at least a few words about the shift to generate
        </p>
      )}

      {/* Switch to structured */}
      <button
        onClick={onSwitchToStructured}
        className="w-full flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-slate-600 transition-colors py-2"
      >
        Switch to structured form <ChevronDown size={12} />
      </button>
    </div>
  );
}
