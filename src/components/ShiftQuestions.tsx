/**
 * ShiftQuestions.tsx — Handova v11.1
 *
 * Shift Assessment Questions panel.
 * Voice recording uses the EXACT same pipeline as useVoiceInput:
 * - Same MediaRecorder setup with codec detection
 * - Same FormData + /api/transcribe call
 * - Same silence detection auto-stop
 * - Same error handling
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useRef, useState, useCallback } from "react";
import { Mic, Square, Loader2, BrainCircuit, CheckCircle2 } from "lucide-react";
import type { ShiftQuestion } from "../types";

interface ShiftQuestionsProps {
  questions: ShiftQuestion[];
  loading: boolean;
  patientName: string;
  onAnswerChange: (id: number, answer: string) => void;
  onRecordingChange: (id: number, isRecording: boolean) => void;
}

// Silence detection constants — identical to useVoiceInput
const SILENCE_THRESHOLD = 10;
const AUTO_STOP_MS = 1500;
const POLL_INTERVAL_MS = 100;
const MIN_BLOB_BYTES = 500;

export default function ShiftQuestions({
  questions,
  loading,
  patientName,
  onAnswerChange,
  onRecordingChange,
}: ShiftQuestionsProps) {
  const [transcribingId, setTranscribingId] = useState<number | null>(null);
  const [recordingId, setRecordingId] = useState<number | null>(null);
  const [errorId, setErrorId] = useState<number | null>(null);

  // Refs — one set, reused per question (only one question records at a time)
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef("");
  const silenceStartRef = useRef<number | null>(null);
  const didAutoStopRef = useRef(false);
  const activeIdRef = useRef<number | null>(null);

  const answeredCount = questions.filter((q) => q.answer.trim().length > 0).length;

  // Tear down mic — identical to useVoiceInput teardown
  const teardown = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    silenceStartRef.current = null;
  }, []);

  // Transcribe — identical to useVoiceInput transcribe
  const transcribe = useCallback(async (id: number, chunks: Blob[], mimeType: string, existingAnswer: string) => {
    const baseMime = mimeType.split(";")[0] || "audio/webm";
    const blob = new Blob(chunks, { type: baseMime });

    if (blob.size < MIN_BLOB_BYTES) {
      setTranscribingId(null);
      return;
    }

    setTranscribingId(id);
    try {
      const ext = baseMime.includes("mp4") ? "mp4" : "webm";
      const form = new FormData();
      form.append("audio", blob, `recording.${ext}`);

      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Transcription failed");

      const transcript = (data.text || "").trim();
      if (transcript) {
        const prev = existingAnswer.trimEnd();
        onAnswerChange(id, prev ? prev + " " + transcript : transcript);
      }
    } catch {
      setErrorId(id);
    } finally {
      setTranscribingId(null);
    }
  }, [onAnswerChange]);

  // Stop recording
  const stopRecording = useCallback((id: number) => {
    teardown();
    setRecordingId(null);
    onRecordingChange(id, false);
    activeIdRef.current = null;

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop(); // onstop fires → transcribe
    }
  }, [teardown, onRecordingChange]);

  // Start recording — identical flow to useVoiceInput start
  const startRecording = useCallback(async (id: number, existingAnswer: string) => {
    setErrorId(null);
    chunksRef.current = [];
    silenceStartRef.current = null;
    didAutoStopRef.current = false;
    activeIdRef.current = id;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });
      streamRef.current = stream;

      // Codec detection — same as useVoiceInput
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
      mimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const capturedId = activeIdRef.current ?? id;
        transcribe(capturedId, chunksRef.current, mimeTypeRef.current, existingAnswer);
        chunksRef.current = [];
      };

      recorder.start(200);

      // Silence detection — identical to useVoiceInput
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      pollTimerRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length) * 255;
        const isSilent = rms < SILENCE_THRESHOLD;
        const now = Date.now();

        if (isSilent) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current >= AUTO_STOP_MS) {
            if (!didAutoStopRef.current) {
              didAutoStopRef.current = true;
              stopRecording(id);
            }
          }
        } else {
          silenceStartRef.current = null;
        }
      }, POLL_INTERVAL_MS);

      setRecordingId(id);
      onRecordingChange(id, true);

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone access denied";
      setErrorId(id);
      console.error("[ShiftQuestions] Mic error:", msg);
    }
  }, [stopRecording, transcribe, onRecordingChange]);

  const handleMic = useCallback((id: number, existingAnswer: string) => {
    if (recordingId === id) {
      stopRecording(id);
    } else {
      startRecording(id, existingAnswer);
    }
  }, [recordingId, startRecording, stopRecording]);

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
                  Recording failed — check microphone permissions or type your answer.
                </p>
              )}
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
