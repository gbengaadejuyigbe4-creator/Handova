/**
 * voiceCapture.ts
 *
 * The single home for the recording settings and for the call to /api/transcribe.
 * useVoiceInput is the only recorder in the app and it reads everything from here.
 * When sign-in arrives (slice D), the token is added in sendForTranscription and nowhere else.
 */

/** Same microphone settings as before. They are kept in one place so they can be tested on real recordings. */
export const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
};

/** Volume (0 to 255) below which the microphone counts as quiet. */
export const SILENCE_THRESHOLD = 10;
/** After the nurse has started speaking, this much quiet ends the recording. Was 1500: a short pause to think cut the recording in two. */
export const AUTO_STOP_MS = 2500;
/** Before the first word, wait this long for the nurse to begin. Was 1500: the recording could end before they spoke. */
export const INITIAL_SILENCE_MS = 8000;
/** After the nurse taps Stop, keep recording this long so the last word is not cut off. */
export const STOP_TAIL_MS = 350;
/** If no audio arrives within this time, show the recording state anyway. */
export const READY_FALLBACK_MS = 1500;
export const POLL_INTERVAL_MS = 100;
export const RECORDER_TIMESLICE_MS = 200;
export const MIN_BLOB_BYTES = 500;

export type SpeechNoteKind = "changed" | "check" | "suggest";

/** Something for the nurse to look at after a transcription. */
export interface SpeechNote {
  kind: SpeechNoteKind;
  message: string;
  from?: string;
  to?: string;
  field?: string;
  confidence?: number | null;
}

export interface TranscribeResult {
  text: string;
  rawText: string;
  notes: SpeechNote[];
}

/** The best recording format this browser can make, or "" to let the browser choose. */
export function pickMimeType(isSupported: (type: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)): string {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (isSupported(type)) return type;
  }
  return "";
}

export const extensionFor = (baseMime: string): "mp4" | "webm" => (baseMime.includes("mp4") ? "mp4" : "webm");

const KINDS: SpeechNoteKind[] = ["changed", "check", "suggest"];

/** Keeps only well-formed notes from the server's reply. */
export function cleanNotes(raw: unknown): SpeechNote[] {
  if (!Array.isArray(raw)) return [];
  const out: SpeechNote[] = [];
  for (const n of raw) {
    if (!n || typeof n !== "object") continue;
    const note = n as Record<string, unknown>;
    if (!KINDS.includes(note.kind as SpeechNoteKind) || typeof note.message !== "string" || !note.message) continue;
    out.push({
      kind: note.kind as SpeechNoteKind,
      message: note.message,
      from: typeof note.from === "string" ? note.from : undefined,
      to: typeof note.to === "string" ? note.to : undefined,
      field: typeof note.field === "string" ? note.field : undefined,
      confidence: typeof note.confidence === "number" ? note.confidence : null,
    });
  }
  return out.slice(0, 8);
}

/** Sends one recording for transcription. Throws an Error with a message the nurse can read. */
export async function sendForTranscription(
  blob: Blob,
  baseMime: string,
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("audio", blob, `recording.${extensionFor(baseMime)}`);

  const res = await fetchFn("/api/transcribe", { method: "POST", body: form });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* an unreadable reply is handled below */
  }
  if (!res.ok) throw new Error(typeof data.error === "string" && data.error ? data.error : "Transcription failed");

  const text = typeof data.text === "string" ? data.text.trim() : "";
  const rawText = typeof data.rawText === "string" ? data.rawText.trim() : text;
  return { text, rawText, notes: cleanNotes(data.notes) };
}
