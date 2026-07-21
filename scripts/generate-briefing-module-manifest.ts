/**
 * generate-briefing-module-manifest.ts — regenerate the committed engine-side
 * Briefing module manifest from the canonical app registry.
 *
 *   npm run generate:briefing-manifest
 *
 * Reads:
 *   - app/src/lib/briefing/registry.ts   (BRIEFING_MODULES — canonical)
 *   - app/src/lib/briefing/contracts.ts  (LEGACY_DASHBOARD_TILE_IDS)
 * Writes:
 *   - src/api/lib/briefingModuleManifest.generated.ts
 *
 * The drift regression test (`src/api/tests/briefingModuleManifest.test.ts`)
 * rebuilds the manifest the same way and fails if the committed file is stale —
 * the engine's validation catalog can never drift from the app registry (the
 * Application Knowledge Index pattern). Run via tsx (scripts are not part of
 * the engine build).
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BRIEFING_MODULES } from "../app/src/lib/briefing/registry.ts";
import { LEGACY_DASHBOARD_TILE_IDS } from "../app/src/lib/briefing/contracts.ts";
import type { BriefingModuleManifest } from "../src/api/lib/briefingModuleManifest.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "..", "src", "api", "lib", "briefingModuleManifest.generated.ts");

export function buildBriefingModuleManifest(): BriefingModuleManifest {
  return {
    schema_version: 1,
    modules: JSON.parse(JSON.stringify(BRIEFING_MODULES)),
    legacy_tile_ids: [...LEGACY_DASHBOARD_TILE_IDS],
  };
}

const manifest = buildBriefingModuleManifest();

const banner =
  "/**\n" +
  " * AUTO-GENERATED — DO NOT EDIT BY HAND.\n" +
  " * Source of truth: app/src/lib/briefing/registry.ts (BRIEFING_MODULES)\n" +
  " *                  + app/src/lib/briefing/contracts.ts (LEGACY_DASHBOARD_TILE_IDS).\n" +
  " * Regenerate: npm run generate:briefing-manifest\n" +
  " * Verified by: src/api/tests/briefingModuleManifest.test.ts (drift check).\n" +
  " * INERT until a B2 write path consumes it via briefingModuleManifest.ts.\n" +
  " */\n";

const body =
  banner +
  'import type { BriefingModuleManifest } from "./briefingModuleManifest.js";\n\n' +
  "export const BRIEFING_MODULE_MANIFEST: BriefingModuleManifest =\n" +
  JSON.stringify(manifest, null, 2) +
  ";\n";

writeFileSync(outFile, body, "utf8");

console.log(
  `Wrote ${outFile}\n  modules: ${manifest.modules.length}\n  legacy tile ids: ${manifest.legacy_tile_ids.length}`
);
