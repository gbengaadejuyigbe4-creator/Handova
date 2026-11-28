import { X } from "lucide-react";
import type { SpeechNote } from "../utils/voiceCapture";

interface TranscriptNotesProps {
  notes: SpeechNote[];
  onDismiss?: () => void;
}

const LABEL: Record<SpeechNote["kind"], string> = {
  changed: "Changed",
  check: "Please check",
  suggest: "Please check",
};

/**
 * Shown under a text box after a voice transcription. It lists anything the nurse should look at:
 * a phrase that was corrected, or a dose, reading or medicine name that was not heard clearly.
 * It never changes the text itself. The nurse stays in control of what is written.
 */
export default function TranscriptNotes({ notes, onDismiss }: TranscriptNotesProps) {
  if (!notes || notes.length === 0) return null;
  return (
    <section
      aria-label="Check the transcript"
      className="mt-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="font-bold text-slate-800 dark:text-slate-100">Check the transcript</p>
        {onDismiss && (
          <button onClick={onDismiss} aria-label="Dismiss these notes" className="p-1 text-slate-600 hover:text-slate-900 dark:hover:text-white">
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {notes.map((n, i) => (
          <li key={`${n.kind}-${i}`} className="text-slate-700 dark:text-slate-300 leading-snug">
            <span className="font-bold text-teal-800 dark:text-teal-300">{LABEL[n.kind]}: </span>
            {n.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
