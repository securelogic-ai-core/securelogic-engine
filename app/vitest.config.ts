/**
 * app/vitest.config.ts — the app's render-test harness.
 *
 * WHY THIS EXISTS: the engine's CI was 8/8 green while the dashboard's "View all open
 * findings" link pointed at a query parameter the /findings page did not read (#638
 * review). Engine tests asserted /api/findings; the tile links to /findings. Nothing
 * rendered a page, so nothing could see it. This config is the smallest harness that
 * makes that class of defect fail CI.
 *
 * Vitest, not a new framework: the engine already standardizes on Vitest 4 and the root
 * config already globs `app/src/**​/__tests__/**​/*.test.ts`. This adds the DOM
 * environment those pure-helper tests never needed, and nothing else.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Both suites: the existing pure-helper tests (.ts) AND the new render tests
    // (.tsx). The helpers keep passing under jsdom — a DOM environment is a superset
    // of what they needed.
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
