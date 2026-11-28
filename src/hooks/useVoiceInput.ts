/**
 * useVoiceInput
 *
 * The one voice recorder in Handova. QuickMode, the patient form, the shift questions and the shift
 * planner all use this hook.
 *
 *  - The nurse taps Start: the microphone opens and recording begins. "Recording" is shown once
 *    audio is really arriving, so the nurse does not speak before it is ready.
 *  - The recording ends after a pause: 2.5 s of quiet once the nurse has started speaking, or 8 s
 *    if they never start. (It used to end after 1.5 s, which could cut a recording in two.)
 *  - The nurse taps Stop: recording continues for a moment so the last word is not cut off.
 *  - The recording is sent for transcription, and the text is added after what was already there.
 *    Anything the nurse should look at comes back as notes.
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  AUDIO_CONSTRAINTS, AUTO_STOP_MS, INITIAL_SILENCE_MS, MIN_BLOB_BYTES, POLL_INTERVAL_MS, READY_FALLBACK_MS,
  RECORDER_TIMESLICE_MS, SILENCE_THRESHOLD, STOP_TAIL_MS, pickMimeType, sendForTranscription,
  type SpeechNote,
} from "../utils/voiceCapture";

interface UseVoiceInputProps {
  onTranscript: (text: string, notes: SpeechNote[]) => void;
  disabled?: boolean;
}

interface UseVoiceInputReturn {
  listening: boolean;
  supported: boolean;
  transcribing: boolean;
  error: string;
  notes: SpeechNote[];
  clearNotes: () => void;
  start: (existingText?: string) => void;
  stop: () => void;
}

export function useVoiceInput({ onTranscript, disabled = false }: UseVoiceInputProps): UseVoiceInputReturn {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<SpeechNote[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef("");
  const silenceStartRef = useRef<number | null>(null);
  const heardSpeechRef = useRef(false);
  const readyRef = useRef(false);
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const unmountedRef = useRef(false);
  const existingTextRef = useRef("");

  // Always call the latest callback, even from a recording that began earlier.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  // ── Tear down mic/audio context ────────────────────────────────────────────
  const teardown = useCallback(() => {
    for (const ref of [pollTimerRef, tailTimerRef, readyTimerRef]) {
      if (ref.current) {
        clearInterval(ref.current as ReturnType<typeof setInterval>);
        clearTimeout(ref.current as ReturnType<typeof setTimeout>);
        ref.current = null;
      }
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    silenceStartRef.current = null;
  }, []);

  // ── Transcribe whatever was recorded ──────────────────────────────────────
  const transcribe = useCallback(async (chunks: Blob[], mimeType: string, existingText: string) => {
    if (unmountedRef.current) return;
    const baseMime = mimeType.split(";")[0] || "audio/webm";
    const blob = new Blob(chunks, { type: baseMime });

    if (blob.size < MIN_BLOB_BYTES) {
      setTranscribing(false);
      return;
    }

    setTranscribing(true);
    try {
      const { text, notes: found } = await sendForTranscription(blob, baseMime);
      if (unmountedRef.current) return;
      if (text) {
        const prev = existingText.trimEnd();
        setNotes(found);
        onTranscriptRef.current(prev ? prev + " " + text : text, found);
      }
    } catch (err) {
      if (!unmountedRef.current) setError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      if (!unmountedRef.current) setTranscribing(false);
    }
  }, []);

  // ── Stop recording ────────────────────────────────────────────────────────
  // immediate: a pause already ended the speech. Otherwise the nurse tapped Stop, so keep
  // recording for STOP_TAIL_MS first and the last word is not cut off.
  const finish = useCallback((immediate: boolean) => {
    if (stoppingRef.current) return;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      teardown();
      setListening(false);
      return;
    }
    stoppingRef.current = true;
    setListening(false);
    const end = () => {
      teardown();
      if (recorder.state !== "inactive") recorder.stop(); // onstop fires, which starts the transcription
    };
    if (immediate) end();
    else tailTimerRef.current = setTimeout(end, STOP_TAIL_MS);
  }, [teardown]);

  const stop = useCallback(() => finish(false), [finish]);

  // ── Start recording ───────────────────────────────────────────────────────
  const start = useCallback(async (existingText = "") => {
    if (disabled || !supported || startingRef.current || stoppingRef.current) return;
    if (recorderRef.current && recorderRef.current.state !== "inactive") return;
    startingRef.current = true;

    setError("");
    setNotes([]);
    existingTextRef.current = existingText;
    chunksRef.current = [];
    silenceStartRef.current = null;
    heardSpeechRef.current = false;
    readyRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
      streamRef.current = stream;

      const mimeType = pickMimeType();
      mimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      const markReady = () => {
        if (readyRef.current) return;
        readyRef.current = true;
        setListening(true);
      };

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
        markReady(); // audio is arriving: only now say "recording"
      };

      recorder.onstop = () => {
        stoppingRef.current = false;
        transcribe(chunksRef.current, mimeTypeRef.current, existingTextRef.current);
        chunksRef.current = [];
      };

      recorder.start(RECORDER_TIMESLICE_MS);
      readyTimerRef.current = setTimeout(markReady, READY_FALLBACK_MS);

      // ── Pause detection ──
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
        const now = Date.now();

        if (rms >= SILENCE_THRESHOLD) {
          heardSpeechRef.current = true;
          silenceStartRef.current = null;
          return;
        }
        if (silenceStartRef.current === null) {
          silenceStartRef.current = now;
          return;
        }
        const limit = heardSpeechRef.current ? AUTO_STOP_MS : INITIAL_SILENCE_MS;
        if (now - silenceStartRef.current >= limit) finish(true);
      }, POLL_INTERVAL_MS);
    } catch (err) {
      teardown();
      const msg = err instanceof Error ? err.message : "Microphone access denied";
      setError(
        msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("permission")
          ? "Microphone permission denied. Please allow mic access."
          : msg,
      );
    } finally {
      startingRef.current = false;
    }
  }, [disabled, supported, finish, teardown, transcribe]);

  const clearNotes = useCallback(() => setNotes([]), []);

  // Release the microphone if the screen is closed mid-recording.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      teardown();
    };
  }, [teardown]);

  return { listening, supported, transcribing, error, notes, clearNotes, start, stop };
}
