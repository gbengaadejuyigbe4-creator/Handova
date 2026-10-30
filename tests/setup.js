import { afterEach, beforeEach, vi } from "vitest";

// Environment for API tests. These are fake values; no real service is called.
process.env.GROQ_API_KEY = "test-groq-key";
// The API routes still check GEMINI_API_KEY before calling Groq (a leftover from
// an earlier migration). Set it so route tests can run. Remove when that is fixed.
process.env.GEMINI_API_KEY = "test-legacy-gate-key";

// Node has no FileReader. The browser code in src/utils/emrExtract.ts uses it,
// so provide the one method it needs.
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class {
    readAsDataURL(file) {
      file.arrayBuffer().then((buf) => {
        this.result = `data:${file.type};base64,${Buffer.from(buf).toString("base64")}`;
        this.onload?.();
      }).catch((err) => this.onerror?.(err));
    }
  };
}

beforeEach(() => {
  // Keep test output readable: the API code logs a lot.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
