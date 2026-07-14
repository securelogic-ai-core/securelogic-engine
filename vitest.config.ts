import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // The root suite globs the app's pure-helper tests (`app/src/**/__tests__/**/*.test.ts`),
  // so it must resolve the same "@" the app compiles against — app/tsconfig.json and
  // app/vitest.config.ts both map it to app/src. Without it, an app helper test that
  // imports "@/test/fixtures" resolves under the app harness and dies under this one.
  // Inert for engine tests: nothing under the engine's own src/ imports via "@/".
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./app/src", import.meta.url)),
    },
  },
  test: {
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/**/tests/**/*.test.ts",
      "src/_frozen_prod/__tests__/**/*.test.ts",
      "packages/**/__tests__/**/*.test.ts",
      "services/**/__tests__/**/*.test.ts",
      "app/src/**/__tests__/**/*.test.ts"
    ],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/packages/_legacy_engine_core/**"
    ]
  }
});
