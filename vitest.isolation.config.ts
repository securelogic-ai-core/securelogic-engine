import { defineConfig } from "vitest/config";

/**
 * Vitest config for the cross-org isolation harness (E1-G1).
 *
 * Kept separate from vitest.config.ts so the default `npm test` unit run
 * stays database-free: that config's `include` covers only src/**, packages/**
 * and services/**, never test/**. The harness runs via `npm run test:isolation`
 * and in the dedicated `cross-org-isolation` CI job, both of which provide a
 * throwaway Postgres via TEST_DATABASE_URL.
 */
export default defineConfig({
  test: {
    include: ["test/isolation/**/*.test.ts"],
    setupFiles: ["test/isolation/setup.ts"],
    // beforeAll drops the schema and applies the full migration set.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // One file, shared seeded state — no cross-file parallelism.
    fileParallelism: false,
  },
});
