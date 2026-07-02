/**
 * workflowRegistry.ts — types, validation, and rendering for the structured
 * workflow registry that powers "Ask SecureLogic" how-to answers.
 *
 * Each workflow is authored as one YAML file under
 * `src/api/productKnowledge/workflows/`. The generator
 * (`scripts/generate-workflow-registry.ts`) parses + validates them and writes
 * the committed `workflows.generated.ts`, which the engine imports at runtime.
 * Ask assembles its how-to answers from the structured fields below — no
 * free-form workflow prose lives in `productKnowledge.ts`.
 *
 * This module is PURE (no YAML parser, no fs, no app imports) so it ships in
 * the engine build. YAML parsing happens only in the generator + tests.
 *
 * Every workflow is validated against the Application Knowledge Index
 * (`applicationKnowledgeIndex`), so its navigation labels, routes, and
 * permissions cannot drift from the real UI.
 */

import type { ApplicationKnowledgeIndex, NavAccess } from "./applicationKnowledgeIndex.js";

export type WorkflowPermission = NavAccess; // "all" | "premium" | "platform" | "admin"

export const WORKFLOW_PERMISSIONS: readonly WorkflowPermission[] = [
  "all",
  "premium",
  "platform",
  "admin",
];

export type Workflow = {
  /** Stable snake_case id; must equal the YAML filename stem. */
  id: string;
  /** Short human title, e.g. "Add a vendor". */
  title: string;
  /** What the user is trying to accomplish. */
  goal: string;
  /** Entitlement required (validated against NavAccess). */
  permissions: WorkflowPermission;
  /** Menu path as labels, e.g. ["Assets", "Vendors"]; each must exist in the index. */
  navigation: string[];
  /** Concrete page routes the workflow touches; each must exist in the index. */
  routes: string[];
  /** Ordered, human-readable steps. */
  ordered_steps: string[];
  /** What success looks like. */
  expected_result: string;
  /** Frequent pitfalls (may be empty). */
  common_mistakes: string[];
  /** Ids of related workflows; each must exist in the registry. */
  related_workflows: string[];
};

/** The set of every navigable label in the index (top-level links + dropdown groups + items). */
export function knownNavLabels(index: ApplicationKnowledgeIndex): Set<string> {
  const labels = new Set<string>();
  for (const item of index.navigation) {
    labels.add(item.label);
    if (item.type === "group") {
      for (const c of item.children) labels.add(c.label);
    }
  }
  return labels;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Validate the whole registry against the schema AND the Application Knowledge
 * Index. Returns a flat list of human-readable error strings (empty = valid).
 * Pure — used by the generator (to fail generation) and the regression test.
 */
export function validateWorkflowRegistry(
  workflows: Workflow[],
  index: ApplicationKnowledgeIndex
): string[] {
  const errors: string[] = [];
  const navLabels = knownNavLabels(index);
  const routeSet = new Set(index.routes.map((r) => r.path));
  const ids = new Set<string>();

  for (const w of workflows) {
    const tag = `workflow "${w?.id ?? "<no id>"}"`;

    if (!isNonEmptyString(w.id)) errors.push(`${tag}: missing/empty id`);
    if (!/^[a-z][a-z0-9_]*$/.test(w.id ?? "")) {
      errors.push(`${tag}: id must be snake_case ([a-z][a-z0-9_]*)`);
    }
    if (ids.has(w.id)) errors.push(`${tag}: duplicate id`);
    ids.add(w.id);

    if (!isNonEmptyString(w.title)) errors.push(`${tag}: missing/empty title`);
    if (!isNonEmptyString(w.goal)) errors.push(`${tag}: missing/empty goal`);
    if (!isNonEmptyString(w.expected_result)) {
      errors.push(`${tag}: missing/empty expected_result`);
    }

    if (!WORKFLOW_PERMISSIONS.includes(w.permissions)) {
      errors.push(`${tag}: invalid permissions "${w.permissions}" (expected ${WORKFLOW_PERMISSIONS.join("/")})`);
    }

    if (!Array.isArray(w.navigation) || w.navigation.length === 0) {
      errors.push(`${tag}: navigation must be a non-empty list`);
    } else {
      for (const label of w.navigation) {
        if (!navLabels.has(label)) {
          errors.push(`${tag}: navigation label "${label}" is not in the Application Knowledge Index`);
        }
      }
    }

    if (!Array.isArray(w.routes) || w.routes.length === 0) {
      errors.push(`${tag}: routes must be a non-empty list`);
    } else {
      for (const route of w.routes) {
        if (!routeSet.has(route)) {
          errors.push(`${tag}: route "${route}" is not a real page route in the index`);
        }
      }
    }

    if (!Array.isArray(w.ordered_steps) || w.ordered_steps.length === 0) {
      errors.push(`${tag}: ordered_steps must be a non-empty list`);
    } else if (!w.ordered_steps.every(isNonEmptyString)) {
      errors.push(`${tag}: ordered_steps contains an empty step`);
    }

    if (!Array.isArray(w.common_mistakes)) {
      errors.push(`${tag}: common_mistakes must be a list`);
    }
    if (!Array.isArray(w.related_workflows)) {
      errors.push(`${tag}: related_workflows must be a list`);
    }
  }

  // related_workflows must resolve and not self-reference (second pass: all ids known).
  for (const w of workflows) {
    if (!Array.isArray(w.related_workflows)) continue;
    for (const rel of w.related_workflows) {
      if (rel === w.id) errors.push(`workflow "${w.id}": related_workflows references itself`);
      if (!ids.has(rel)) {
        errors.push(`workflow "${w.id}": related workflow "${rel}" does not exist`);
      }
    }
  }

  return errors;
}

function accessLabel(access: WorkflowPermission): string {
  switch (access) {
    case "platform":
      return "Platform tier";
    case "premium":
      return "paid tier";
    case "admin":
      return "admin only";
    case "all":
      return "any signed-in user";
  }
}

/** Render one workflow as a compact, structured block for the Ask system prompt. */
export function renderWorkflow(w: Workflow): string {
  const lines: string[] = [];
  lines.push(`Workflow: ${w.title} (id: ${w.id})`);
  lines.push(`Goal: ${w.goal}`);
  lines.push(`Who can do this: ${accessLabel(w.permissions)}`);
  lines.push(`Where: ${w.navigation.join(" → ")}`);
  lines.push("Steps:");
  w.ordered_steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  lines.push(`Result: ${w.expected_result}`);
  if (w.common_mistakes.length > 0) {
    lines.push(`Common mistakes: ${w.common_mistakes.join("; ")}`);
  }
  if (w.related_workflows.length > 0) {
    lines.push(`Related: ${w.related_workflows.join(", ")}`);
  }
  return lines.join("\n");
}

/** Render the whole registry (deterministic order = input order, which the generator sorts by id). */
export function renderWorkflows(workflows: Workflow[]): string {
  return workflows.map(renderWorkflow).join("\n\n");
}
