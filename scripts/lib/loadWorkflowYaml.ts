/**
 * loadWorkflowYaml.ts — read + parse the authored workflow YAML files.
 *
 * Shared by the generator (`generate-workflow-registry.ts`) and the regression
 * test so both load the registry identically. Node + js-yaml only; lives under
 * scripts/ and is never part of the engine build (the engine imports the
 * generated `workflows.generated.ts`, not YAML).
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { load as loadYaml } from "js-yaml";
import type { Workflow } from "../../src/api/lib/workflowRegistry.ts";

export type LoadedWorkflow = { file: string; stem: string; workflow: Workflow };

export function loadWorkflowYaml(dir: string): LoadedWorkflow[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();

  return files.map((file) => {
    const workflow = loadYaml(readFileSync(join(dir, file), "utf8")) as Workflow;
    return { file, stem: basename(file).replace(/\.ya?ml$/, ""), workflow };
  });
}

/** Workflows sorted by id (the deterministic order the generated registry uses). */
export function loadWorkflowRegistry(dir: string): Workflow[] {
  return loadWorkflowYaml(dir)
    .map((l) => l.workflow)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
