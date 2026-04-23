import { Mic, Square, Loader2 } from "lucide-react";
import { useVoiceInput } from "../hooks/useVoiceInput";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  existingText?: string;
  disabled?: boolean;
}

export default function VoiceInput({ onTranscript, existingText = "", disabled = false }: VoiceInputProps) {
  const { listening, supported, transcribing, error, start, stop } = useVoiceInput({ onTranscript, disabled });

  if (!supported) return null;

  return (
    <div className="flex items-center gap-3">
      {!listening && !transcribing ? (
        <button
          onClick={() => start(existingText)}
          disabled={disabled}
          className="btn-voice"
        >
          <Mic size={14} />
          Speak shift events
        </button>
      ) : listening ? (
        <button onClick={stop} className="btn-voice-recording">
          <Square size={13} fill="currentColor" />
          Stop recording
        </button>
      ) : null}

      {listening && (
        <span className="flex items-center gap-1.5 text-xs text-red-400">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          Recording…
        </span>
      )}

      {transcribing && (
        <span className="flex items-center gap-1.5 text-xs text-teal-400">
          <Loader2 size={12} className="animate-spin" />
          Transcribing…
        </span>
      )}

      {error && (
        <span className="text-xs text-red-400">{error}</span>
      )}
    </div>
  );
}
