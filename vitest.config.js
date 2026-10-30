import { defineConfig } from "vitest/config";

// Phase 0 test setup: plain Node environment, no browser needed.
// Tests use synthetic data only. Never put real patient records in tests/.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup.js"],
  },
});
