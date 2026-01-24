import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/_frozen_prod/__tests__/**/*.test.ts",
      "packages/**/__tests__/**/*.test.ts"
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
