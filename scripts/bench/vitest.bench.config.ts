/**
 * Bench-only vitest config. Kept OUT of the root config's include globs so CI
 * never runs a timing measurement as a pass/fail test.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/bench/**/*.bench.ts"],
    testTimeout: 120_000
  }
});
