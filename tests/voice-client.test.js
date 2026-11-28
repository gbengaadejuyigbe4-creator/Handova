import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AUDIO_CONSTRAINTS, AUTO_STOP_MS, INITIAL_SILENCE_MS, STOP_TAIL_MS, MIN_BLOB_BYTES,
  cleanNotes, extensionFor, pickMimeType, sendForTranscription,
} from "../src/utils/voiceCapture.ts";
import TranscriptNotes from "../src/components/TranscriptNotes.tsx";

const read = (f) => readFileSync(f, "utf8");

// ---------------------------------------------------------------------------------------
describe("recording settings", () => {
  it("keeps the microphone settings that were already in use", () => {
    expect(AUDIO_CONSTRAINTS).toEqual({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } });
  });
  it("waits for a thinking pause, and for a nurse who has not started yet", () => {
    expect(AUTO_STOP_MS).toBeGreaterThanOrEqual(2000);        // was 1500 and cut recordings in two
    expect(INITIAL_SILENCE_MS).toBeGreaterThan(AUTO_STOP_MS); // before the first word, wait longer
  });
  it("keeps recording briefly after Stop, but not long enough to feel slow", () => {
    expect(STOP_TAIL_MS).toBeGreaterThanOrEqual(200);
    expect(STOP_TAIL_MS).toBeLessThanOrEqual(800);
  });
  it("ignores clips too small to hold speech", () => {
    expect(MIN_BLOB_BYTES).toBe(500);
  });
});

describe("choosing a recording format", () => {
  it("prefers webm with opus, then webm, then mp4", () => {
    expect(pickMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickMimeType((t) => t !== "audio/webm;codecs=opus")).toBe("audio/webm");
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
  });
  it("lets the browser choose when none is listed", () => {
    expect(pickMimeType(() => false)).toBe("");
  });
  it("names the file by its format", () => {
    expect(extensionFor("audio/mp4")).toBe("mp4");
    expect(extensionFor("audio/webm")).toBe("webm");
    expect(extensionFor("")).toBe("webm");
  });
});

describe("notes from the server", () => {
  it("keeps well-formed notes", () => {
    const [n] = cleanNotes([{ kind: "changed", message: "m", from: "a", to: "b", field: "dose", confidence: 0.4 }]);
    expect(n).toEqual({ kind: "changed", message: "m", from: "a", to: "b", field: "dose", confidence: 0.4 });
  });
  it("drops anything malformed, and never throws", () => {
    for (const bad of [null, undefined, "x", 5, {}, [null], [{}], [{ kind: "other", message: "m" }], [{ kind: "check" }], [{ kind: "check", message: "" }]]) {
      expect(cleanNotes(bad)).toEqual([]);
    }
  });
  it("shows no more than eight", () => {
    expect(cleanNotes(Array.from({ length: 20 }, () => ({ kind: "check", message: "m" })))).toHaveLength(8);
  });
  it("ignores fields of the wrong type", () => {
    const [n] = cleanNotes([{ kind: "check", message: "m", from: 5, confidence: "high" }]);
    expect(n.from).toBeUndefined();
    expect(n.confidence).toBeNull();
  });
});

describe("sending a recording", () => {
  const reply = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });

  it("posts the recording as a form to /api/transcribe", async () => {
    let seen;
    const fetchFn = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ text: " Pulse 88 ", rawText: "pulse 88", notes: [] }) }; };
    const out = await sendForTranscription(new Blob(["abc"], { type: "audio/webm" }), "audio/webm", fetchFn);
    expect(seen.url).toBe("/api/transcribe");
    expect(seen.init.method).toBe("POST");
    expect(seen.init.body.get("audio").name).toBe("recording.webm");
    expect(out).toEqual({ text: "Pulse 88", rawText: "pulse 88", notes: [] });
  });
  it("names an mp4 recording as mp4", async () => {
    let body;
    await sendForTranscription(new Blob(["abc"]), "audio/mp4", async (_u, init) => { body = init.body; return { ok: true, status: 200, json: async () => ({ text: "x" }) }; });
    expect(body.get("audio").name).toBe("recording.mp4");
  });
  it("uses the text as the raw text when an older server sends none", async () => {
    const out = await sendForTranscription(new Blob(["a"]), "audio/webm", reply(200, { text: "ok" }));
    expect(out).toEqual({ text: "ok", rawText: "ok", notes: [] });
  });
  it("passes on the server's error message", async () => {
    await expect(sendForTranscription(new Blob(["a"]), "audio/webm", reply(500, { error: "Deepgram error: busy" }))).rejects.toThrow("Deepgram error: busy");
  });
  it("gives a plain message when the reply cannot be read", async () => {
    const broken = async () => ({ ok: false, status: 502, json: async () => { throw new Error("not json"); } });
    await expect(sendForTranscription(new Blob(["a"]), "audio/webm", broken)).rejects.toThrow("Transcription failed");
  });
  it("copes with a reply that has no text", async () => {
    expect((await sendForTranscription(new Blob(["a"]), "audio/webm", reply(200, {}))).text).toBe("");
  });
});

describe("the notes panel", () => {
  const html = (props) => renderToStaticMarkup(createElement(TranscriptNotes, props));
  it("shows nothing when there is nothing to check", () => {
    expect(html({ notes: [] })).toBe("");
    expect(html({ notes: undefined })).toBe("");
  });
  it("lists each note with a plain label", () => {
    const out = html({ notes: [
      { kind: "changed", message: 'Changed "Bacter signs" to "Vital signs".' },
      { kind: "check", message: "The dose was heard with low confidence." },
      { kind: "suggest", message: "May have been vital signs." },
    ] });
    expect(out).toContain("Check the transcript");
    expect(out).toContain("Changed: ");
    expect(out.match(/Please check: /g)).toHaveLength(2);
    expect(out).toContain("Bacter signs");
  });
  it("offers a way to dismiss, only when it can be dismissed", () => {
    expect(html({ notes: [{ kind: "check", message: "m" }], onDismiss: () => {} })).toContain('aria-label="Dismiss these notes"');
    expect(html({ notes: [{ kind: "check", message: "m" }] })).not.toContain("Dismiss");
  });
  it("escapes the text, so a transcript cannot inject markup", () => {
    const out = html({ notes: [{ kind: "check", message: '<img src=x onerror="alert(1)">' }] });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});

// ---------------------------------------------------------------------------------------
// There is one recorder. These checks read the source, because the browser's microphone cannot be
// used in a unit test. The real recording flow was tested in a browser with a fake microphone.
// ---------------------------------------------------------------------------------------
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("one recorder for the whole app", () => {
  const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
  const using = (needle) => files.filter((f) => read(f).includes(needle)).map((f) => f.replace(/\\/g, "/"));

  it("opens the microphone in one place only", () => {
    expect(using("getUserMedia")).toEqual(["src/hooks/useVoiceInput.ts"]);
    expect(using("new MediaRecorder")).toEqual(["src/hooks/useVoiceInput.ts"]);
  });
  it("calls the transcription route in one place only", () => {
    expect(using('"/api/transcribe"')).toEqual(["src/utils/voiceCapture.ts"]);
  });
  it.each(["src/components/QuickMode.tsx", "src/components/VoiceInput.tsx", "src/components/ShiftQuestions.tsx", "src/components/ShiftPlanner.tsx"])(
    "%s uses the shared recorder and shows its notes", (f) => {
      const src = read(f);
      expect(src).toContain("useVoiceInput");
      expect(src).toContain("TranscriptNotes");
    },
  );
  it("has no leftover copy of the recorder", () => {
    expect(read("src/components/ShiftPlanner.tsx")).not.toContain("useQuickVoice");
    expect(read("src/components/ShiftQuestions.tsx")).not.toContain("SILENCE_THRESHOLD");
  });
  it("does not add earlier text a second time in the mid-shift update", () => {
    const src = read("src/components/ShiftPlanner.tsx");
    expect(src).toContain("useVoiceInput({ onTranscript: (text) => setMidShiftUpdate(text) })");
    expect(src).not.toMatch(/setMidShiftUpdate\(prev => prev \? prev \+ " " \+ text/);
  });

  describe("how the recorder behaves", () => {
    const hook = read("src/hooks/useVoiceInput.ts");
    it("says 'recording' only when audio is arriving", () => {
      expect(hook).toMatch(/ondataavailable[\s\S]{0,200}markReady\(\)/);
      expect(hook).toContain("READY_FALLBACK_MS");
    });
    it("keeps recording briefly after a tap on Stop, but not after a pause has already ended the speech", () => {
      expect(hook).toContain("const stop = useCallback(() => finish(false), [finish]);");
      expect(hook).toContain("finish(true)");
      expect(hook).toContain("setTimeout(end, STOP_TAIL_MS)");
    });
    it("waits longer for the first word than for a pause after it", () => {
      expect(hook).toContain("heardSpeechRef.current ? AUTO_STOP_MS : INITIAL_SILENCE_MS");
    });
    it("cannot be started twice, or restarted while it is finishing", () => {
      expect(hook).toContain("startingRef.current || stoppingRef.current");
    });
    it("releases the microphone when the screen is closed, and drops a late reply", () => {
      expect(hook).toMatch(/unmountedRef\.current = true;\s*teardown\(\);/); // the microphone is released
      expect(hook).toContain("if (unmountedRef.current) return;");
    });
    it("adds the new words after the existing text, and hands over the notes", () => {
      expect(hook).toContain('onTranscriptRef.current(prev ? prev + " " + text : text, found)');
    });
  });
});
