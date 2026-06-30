/**
 * generate-app-knowledge-index.ts — regenerate the committed Application
 * Knowledge Index from the live sources.
 *
 *   npm run generate:knowledge-index
 *
 * Reads:
 *   - app/src/lib/navigation.ts  (NAV_ITEMS — the header menu)
 *   - app/src/app/**             (page route tree)
 * Writes:
 *   - src/api/lib/applicationKnowledgeIndex.generated.ts
 *
 * The drift regression test (`src/api/tests/applicationKnowledgeIndex.test.ts`)
 * rebuilds the index the same way and fails if the committed file is stale, so
 * "Ask SecureLogic" navigation answers can never diverge from the real menu.
 *
 * Run via tsx (scripts are not part of the engine build).
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NAV_ITEMS } from "../app/src/lib/navigation.ts";
import { scanAppRoutes } from "./lib/scanAppRoutes.ts";
import {
  buildApplicationKnowledgeIndex,
  type NavInputItem,
} from "../src/api/lib/applicationKnowledgeIndex.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const appAppDir = join(repoRoot, "app", "src", "app");
const outFile = join(repoRoot, "src", "api", "lib", "applicationKnowledgeIndex.generated.ts");

const routes = scanAppRoutes(appAppDir);
const index = buildApplicationKnowledgeIndex(NAV_ITEMS as NavInputItem[], routes);

const banner =
  "/**\n" +
  " * AUTO-GENERATED — DO NOT EDIT BY HAND.\n" +
  " * Source of truth: app/src/lib/navigation.ts + app/src/app/** route tree.\n" +
  " * Regenerate: npm run generate:knowledge-index\n" +
  " * Verified by: src/api/tests/applicationKnowledgeIndex.test.ts (drift check).\n" +
  " */\n";

const body =
  banner +
  'import type { ApplicationKnowledgeIndex } from "./applicationKnowledgeIndex.js";\n\n' +
  "export const APPLICATION_KNOWLEDGE_INDEX: ApplicationKnowledgeIndex =\n" +
  JSON.stringify(index, null, 2) +
  ";\n";

writeFileSync(outFile, body, "utf8");

console.log(
  `Wrote ${outFile}\n  navigation items: ${index.navigation.length}\n  destinations: ${index.destinations.length}\n  routes: ${index.routes.length}`
);
