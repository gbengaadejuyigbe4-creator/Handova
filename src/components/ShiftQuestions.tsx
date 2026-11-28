/**
 * ShiftQuestions.tsx — Handova v11.1
 *
 * Shift Assessment Questions panel.
 * Voice recording uses useVoiceInput itself (the one recorder in Handova), so the
 * recording settings, pause handling, transcription call and notes are shared.
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { Mic, Square, Loader2, BrainCircuit, CheckCircle2 } from "lucide-react";
import type { ShiftQuestion } from "../types";
import { useVoiceInput } from "../hooks/useVoiceInput";
import TranscriptNotes from "./TranscriptNotes";
import type { SpeechNote } from "../utils/voiceCapture";

interface ShiftQuestionsProps {
  questions: ShiftQuestion[];
  loading: boolean;
  patientName: string;
  onAnswerChange: (id: number, answer: string) => void;
  onRecordingChange: (id: number, isRecording: boolean) => void;
}

export default function ShiftQuestions({
  questions,
  loading,
  patientName,
  onAnswerChange,
  onRecordingChange,
}: ShiftQuestionsProps) {
  // One shared recorder (useVoiceInput). Only one question records at a time, so the question
  // being answered is remembered here and the recorder's state is read through it.
  const activeIdRef = useRef<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [notesById, setNotesById] = useState<Record<number, SpeechNote[]>>({});

  const voice = useVoiceInput({
    onTranscript: (text, notes) => {
      const id = activeIdRef.current;
      if (id === null) return;
      onAnswerChange(id, text);
      setNotesById((prev) => ({ ...prev, [id]: notes }));
    },
  });

  const recordingId = voice.listening ? activeId : null;
  const transcribingId = voice.transcribing ? activeId : null;
  const errorId = voice.error ? activeId : null;

  // Tell the parent when recording really starts and stops.
  useEffect(() => {
    if (activeId !== null) onRecordingChange(activeId, voice.listening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.listening]);

  const answeredCount = questions.filter((q) => q.answer.trim().length > 0).length;

  const clearNotes = (id: number) =>
    setNotesById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const handleMic = useCallback((id: number, existingAnswer: string) => {
    if (voice.listening && activeId === id) {
      voice.stop();
      return;
    }
    activeIdRef.current = id;
    setActiveId(id);
    clearNotes(id);
    voice.start(existingAnswer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.listening, voice.start, voice.stop, activeId]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
          <Loader2 size={15} className="text-teal-600 animate-spin" />
        </div>
        <div>
          <p className="text-xs font-semibold text-teal-800">Analysing HMS record…</p>
          <p className="text-[11px] text-teal-600 mt-0.5">
            Generating shift assessment questions for this patient
          </p>
        </div>
      </div>
    );
  }

  if (!questions || questions.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="icon-container-indigo" style={{ width: 28, height: 28, borderRadius: 9 }}>
            <BrainCircuit size={13} className="text-indigo-600" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-700">Shift Assessment Questions</span>
            <span className="text-[11px] text-slate-400 ml-2">
              — based on {patientName ? patientName.split(" ")[0] + "'s" : "this patient's"} HMS record
            </span>
          </div>
        </div>
        <div className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full ${
          answeredCount === questions.length
            ? "bg-teal-100 text-teal-700"
            : answeredCount > 0
            ? "bg-amber-100 text-amber-700"
            : "bg-slate-100 text-slate-500"
        }`}>
          {answeredCount === questions.length && <CheckCircle2 size={10} />}
          {answeredCount} / {questions.length} answered
        </div>
      </div>

      {/* Questions */}
      <div className="divide-y divide-slate-100">
        {questions.map((q, index) => {
          const isLast = index === questions.length - 1;
          const isRecordingThis = recordingId === q.id;
          const isTranscribingThis = transcribingId === q.id;
          const hasError = errorId === q.id;
          const hasAnswer = q.answer.trim().length > 0;
          const otherRecording = recordingId !== null && recordingId !== q.id;

          return (
            <div key={q.id} className={`px-4 py-3 space-y-2 ${isLast ? "bg-slate-50/70" : ""}`}>
              {/* Question */}
              <div className="flex items-start gap-2">
                <span className={`text-[11px] font-bold mt-0.5 flex-shrink-0 w-5 ${
                  hasAnswer ? "text-teal-500" : "text-slate-400"
                }`}>
                  {hasAnswer ? "✓" : `${index + 1}.`}
                </span>
                <p className={`text-xs leading-relaxed ${
                  isLast ? "text-slate-500 italic" : "text-slate-700"
                }`}>
                  {q.question}
                </p>
              </div>

              {/* Answer + mic */}
              <div className="flex gap-2 pl-5">
                <div className="flex-1 relative">
                  <textarea
                    value={q.answer}
                    onChange={e => onAnswerChange(q.id, e.target.value)}
                    placeholder={
                      isTranscribingThis ? "Transcribing…"
                      : isRecordingThis ? "Listening… speak now"
                      : isLast ? "Any additional observations…"
                      : "Type or tap mic to speak…"
                    }
                    disabled={isRecordingThis || isTranscribingThis}
                    rows={2}
                    className={`w-full text-xs rounded-lg border px-3 py-2 resize-none leading-relaxed transition-colors focus:outline-none focus:ring-0 placeholder:text-slate-300 ${
                      hasAnswer
                        ? "border-teal-200 bg-teal-50/60 text-slate-700 focus:border-teal-400"
                        : "border-slate-200 bg-white text-slate-700 focus:border-teal-300"
                    } ${isTranscribingThis || isRecordingThis ? "opacity-60" : ""}`}
                  />
                  {isTranscribingThis && (
                    <div className="absolute right-2 top-2">
                      <Loader2 size={12} className="text-teal-500 animate-spin" />
                    </div>
                  )}
                  {isRecordingThis && (
                    <div className="absolute right-2 top-2 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[10px] text-red-500 font-semibold">REC</span>
                    </div>
                  )}
                </div>

                {/* Mic button */}
                <button
                  onClick={() => handleMic(q.id, q.answer)}
                  disabled={isTranscribingThis || otherRecording}
                  title={isRecordingThis ? "Stop recording" : "Speak answer"}
                  className={`flex-shrink-0 w-9 h-9 mt-0.5 rounded-xl flex items-center justify-center transition-all duration-200 ${
                    isRecordingThis
                      ? "bg-red-500 text-white shadow-md shadow-red-200 recording-pulse"
                      : isTranscribingThis || otherRecording
                      ? "bg-slate-100 text-slate-300 cursor-not-allowed"
                      : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 hover:shadow-sm"
                  }`}
                >
                  {isRecordingThis
                    ? <Square size={12} fill="currentColor" />
                    : <Mic size={13} />
                  }
                </button>
              </div>

              {/* States */}
              {isRecordingThis && (
                <p className="text-[11px] text-red-500 pl-5 flex items-center gap-1.5 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  Recording — tap stop or pause to auto-stop
                </p>
              )}
              {isTranscribingThis && (
                <p className="text-[11px] text-teal-600 pl-5 flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin" />
                  Transcribing with Deepgram Nova Medical…
                </p>
              )}
              {hasError && !isRecordingThis && !isTranscribingThis && (
                <p className="text-[11px] text-red-500 pl-5">
                  {voice.error || "Recording failed — check microphone permissions or type your answer."}
                </p>
              )}
              <div className="pl-5">
                <TranscriptNotes notes={notesById[q.id] ?? []} onDismiss={() => clearNotes(q.id)} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100">
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Answer as many as you can. Unanswered questions are skipped. Answers combine with the HMS record for a detailed nurses' note.
        </p>
      </div>
    </div>
  );
}
