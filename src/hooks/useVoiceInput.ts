/**
 * useVoiceInput
 *
 * Simple push-to-record with auto-stop on silence.
 * - Nurse taps Start → mic opens, recording begins
 * - Nurse pauses for 1.5s → recording auto-stops and transcribes
 * - Nurse taps Stop → recording stops and transcribes immediately
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useState, useRef, useCallback } from "react";

const SILENCE_THRESHOLD = 10;      // RMS volume below this = silence
const AUTO_STOP_MS = 1500;         // 1.5s silence → auto stop + transcribe
const POLL_INTERVAL_MS = 100;      // volume check every 100ms
const MIN_BLOB_BYTES = 500;        // ignore blips smaller than this

interface UseVoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

interface UseVoiceInputReturn {
  listening: boolean;
  supported: boolean;
  transcribing: boolean;
  error: string;
  start: (existingText?: string) => void;
  stop: () => void;
}

export function useVoiceInput({ onTranscript, disabled = false }: UseVoiceInputProps): UseVoiceInputReturn {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef("");
  const silenceStartRef = useRef<number | null>(null);
  const existingTextRef = useRef("");
  const didAutoStopRef = useRef(false);

  const supported =
    typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  // ── Tear down mic/audio context ────────────────────────────────────────────
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
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    silenceStartRef.current = null;
  }, []);

  // ── Transcribe whatever was recorded ──────────────────────────────────────
  const transcribe = useCallback(async (chunks: Blob[], mimeType: string, existingText: string) => {
    const baseMime = mimeType.split(";")[0] || "audio/webm";
    const blob = new Blob(chunks, { type: baseMime });

    if (blob.size < MIN_BLOB_BYTES) {
      setTranscribing(false);
      return;
    }

    setTranscribing(true);
    try {
      const ext = baseMime.includes("mp4") ? "mp4" : "webm";
      const form = new FormData();
      form.append("audio", blob, `recording.${ext}`);

      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Transcription failed");

      const transcript = (data.text || "").trim();
      if (transcript) {
        const prev = existingText.trimEnd();
        onTranscript(prev ? prev + " " + transcript : transcript);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transcription failed";
      setError(msg);
    } finally {
      setTranscribing(false);
    }
  }, [onTranscript]);

  // ── Stop recording (manual or auto) ───────────────────────────────────────
  const stop = useCallback(() => {
    teardown();
    setListening(false);

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop(); // onstop will fire → triggers transcribe
    }
  }, [teardown]);

  // ── Start recording ───────────────────────────────────────────────────────
  const start = useCallback(async (existingText = "") => {
    if (disabled || !supported) return;

    setError("");
    existingTextRef.current = existingText;
    didAutoStopRef.current = false;
    chunksRef.current = [];
    silenceStartRef.current = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });
      streamRef.current = stream;

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

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Transcribe all collected chunks
        transcribe(chunksRef.current, mimeTypeRef.current, existingTextRef.current);
        chunksRef.current = [];
      };

      recorder.start(200); // collect chunks every 200ms

      // ── Silence detection ──
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
              stop(); // auto-stop after 1.5s silence
            }
          }
        } else {
          silenceStartRef.current = null;
        }
      }, POLL_INTERVAL_MS);

      setListening(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone access denied";
      setError(
        msg.toLowerCase().includes("denied")
          ? "Microphone permission denied. Please allow mic access."
          : msg
      );
    }
  }, [disabled, supported, stop, transcribe]);

  return { listening, supported, transcribing, error, start, stop };
}
