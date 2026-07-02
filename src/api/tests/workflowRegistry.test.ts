import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NAV_ITEMS } from "../../../app/src/lib/navigation.js";
import { scanAppRoutes } from "../../../scripts/lib/scanAppRoutes.js";
import {
  loadWorkflowYaml,
  loadWorkflowRegistry,
} from "../../../scripts/lib/loadWorkflowYaml.js";
import {
  buildApplicationKnowledgeIndex,
  type NavInputItem,
} from "../lib/applicationKnowledgeIndex.js";
import {
  validateWorkflowRegistry,
  knownNavLabels,
  WORKFLOW_PERMISSIONS,
  renderWorkflow,
} from "../lib/workflowRegistry.js";
import { WORKFLOW_REGISTRY } from "../productKnowledge/workflows.generated.js";

const here = dirname(fileURLToPath(import.meta.url));
const workflowDir = join(here, "..", "productKnowledge", "workflows");
const appAppDir = join(here, "..", "..", "..", "app", "src", "app");

const index = buildApplicationKnowledgeIndex(
  NAV_ITEMS as NavInputItem[],
  scanAppRoutes(appAppDir)
);
const loaded = loadWorkflowYaml(workflowDir);
const fromYaml = loadWorkflowRegistry(workflowDir);

const navLabels = knownNavLabels(index);
const routeSet = new Set(index.routes.map((r) => r.path));
const ids = new Set(WORKFLOW_REGISTRY.map((w) => w.id));

describe("Workflow registry — committed artifact is not stale", () => {
  it("the committed registry equals a fresh load of the YAML (run `npm run generate:workflows` if this fails)", () => {
    expect(fromYaml).toEqual(WORKFLOW_REGISTRY);
  });

  it("has a non-trivial set of workflows", () => {
    expect(WORKFLOW_REGISTRY.length).toBeGreaterThanOrEqual(10);
  });

  it("every YAML filename stem equals its workflow id", () => {
    const mismatches = loaded.filter((l) => l.workflow.id !== l.stem);
    expect(mismatches.map((m) => `${m.file} → ${m.workflow.id}`)).toEqual([]);
  });
});

describe("Workflow registry — validates against the schema + Application Knowledge Index", () => {
  it("passes full validation with zero errors", () => {
    expect(validateWorkflowRegistry(WORKFLOW_REGISTRY, index)).toEqual([]);
  });

  it("every navigation label exists in the index", () => {
    for (const w of WORKFLOW_REGISTRY) {
      for (const label of w.navigation) {
        expect(navLabels.has(label), `${w.id}: nav label "${label}"`).toBe(true);
      }
    }
  });

  it("every workflow route is a real page route", () => {
    for (const w of WORKFLOW_REGISTRY) {
      for (const route of w.routes) {
        expect(routeSet.has(route), `${w.id}: route "${route}"`).toBe(true);
      }
    }
  });

  it("every permission is a valid entitlement level", () => {
    for (const w of WORKFLOW_REGISTRY) {
      expect(WORKFLOW_PERMISSIONS, w.id).toContain(w.permissions);
    }
  });

  it("every related_workflows id exists and is not a self-reference", () => {
    for (const w of WORKFLOW_REGISTRY) {
      for (const rel of w.related_workflows) {
        expect(rel, `${w.id} self-ref`).not.toBe(w.id);
        expect(ids.has(rel), `${w.id} → related "${rel}"`).toBe(true);
      }
    }
  });

  it("no workflow has empty ordered steps, and ids are unique", () => {
    const seen = new Set<string>();
    for (const w of WORKFLOW_REGISTRY) {
      expect(w.ordered_steps.length, `${w.id} steps`).toBeGreaterThan(0);
      expect(w.ordered_steps.every((s) => s.trim().length > 0), `${w.id} empty step`).toBe(true);
      expect(seen.has(w.id), `duplicate ${w.id}`).toBe(false);
      seen.add(w.id);
    }
  });

  it("a broken workflow is rejected by validation (negative control)", () => {
    const broken = [
      {
        id: "broken",
        title: "Broken",
        goal: "g",
        permissions: "wizard" as never,
        navigation: ["Nonexistent Menu"],
        routes: ["/this/does/not/exist"],
        ordered_steps: ["do it"],
        expected_result: "r",
        common_mistakes: [],
        related_workflows: ["also_missing"],
      },
    ];
    const errors = validateWorkflowRegistry(broken, index);
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors.join("\n")).toMatch(/permission/i);
    expect(errors.join("\n")).toMatch(/navigation label/i);
    expect(errors.join("\n")).toMatch(/route/i);
    expect(errors.join("\n")).toMatch(/related/i);
  });
});

describe("Workflow rendering", () => {
  it("renders a structured block with goal, permission, where, steps, and result", () => {
    const w = WORKFLOW_REGISTRY.find((x) => x.id === "add_vendor")!;
    const out = renderWorkflow(w);
    expect(out).toContain("Workflow: Add a vendor (id: add_vendor)");
    expect(out).toContain("Goal:");
    expect(out).toContain("Who can do this:");
    expect(out).toContain("Where: Assets → Vendors");
    expect(out).toContain("Steps:");
    expect(out).toContain("Result:");
  });
});
