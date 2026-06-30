/**
 * generate-workflow-registry.ts — validate the authored workflow YAML and
 * regenerate the committed registry.
 *
 *   npm run generate:workflows
 *
 * Reads:   src/api/productKnowledge/workflows/*.yaml
 * Against: the Application Knowledge Index (nav labels + routes + permissions)
 * Writes:  src/api/productKnowledge/workflows.generated.ts
 *
 * Generation FAILS (non-zero exit) if any workflow is invalid — bad schema,
 * a navigation label or route not in the index, an invalid permission, a
 * filename that doesn't match its id, or a dangling related workflow. The
 * drift regression test re-runs the same load + validation, so the registry
 * can never diverge from the real UI.
 *
 * Run via tsx (scripts are not part of the engine build).
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NAV_ITEMS } from "../app/src/lib/navigation.ts";
import { scanAppRoutes } from "./lib/scanAppRoutes.ts";
import { loadWorkflowYaml } from "./lib/loadWorkflowYaml.ts";
import {
  buildApplicationKnowledgeIndex,
  type NavInputItem,
} from "../src/api/lib/applicationKnowledgeIndex.ts";
import { validateWorkflowRegistry } from "../src/api/lib/workflowRegistry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const workflowDir = join(repoRoot, "src", "api", "productKnowledge", "workflows");
const appAppDir = join(repoRoot, "app", "src", "app");
const outFile = join(repoRoot, "src", "api", "productKnowledge", "workflows.generated.ts");

const loaded = loadWorkflowYaml(workflowDir);

// filename stem must equal the workflow id.
const fileErrors = loaded
  .filter((l) => l.workflow.id !== l.stem)
  .map((l) => `file ${l.file}: id "${l.workflow.id}" must equal filename stem "${l.stem}"`);

const workflows = loaded
  .map((l) => l.workflow)
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const index = buildApplicationKnowledgeIndex(
  NAV_ITEMS as NavInputItem[],
  scanAppRoutes(appAppDir)
);

const errors = [...fileErrors, ...validateWorkflowRegistry(workflows, index)];
if (errors.length > 0) {
  console.error("Workflow registry validation FAILED:\n  - " + errors.join("\n  - "));
  process.exit(1);
}

const banner =
  "/**\n" +
  " * AUTO-GENERATED — DO NOT EDIT BY HAND.\n" +
  " * Source of truth: src/api/productKnowledge/workflows/*.yaml\n" +
  " * Regenerate: npm run generate:workflows\n" +
  " * Verified by: src/api/tests/workflowRegistry.test.ts (validation + drift).\n" +
  " */\n";

const body =
  banner +
  'import type { Workflow } from "../lib/workflowRegistry.js";\n\n' +
  "export const WORKFLOW_REGISTRY: Workflow[] =\n" +
  JSON.stringify(workflows, null, 2) +
  ";\n";

writeFileSync(outFile, body, "utf8");

console.log(`Wrote ${outFile}\n  workflows: ${workflows.length}`);
