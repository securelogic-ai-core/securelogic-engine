# Workflow Registry

> Structured, validated how-to workflows that power **Ask SecureLogic**'s step-by-step answers. Authored as YAML, validated against the **Application Knowledge Index**, generated into a committed artifact, and drift-locked by CI — so workflow answers can never describe a UI that doesn't exist.

## Why it exists

Ask's how-to answers used to be free-form prose in `productKnowledge.ts`. Prose drifts: a renamed menu item or moved page silently makes the answer wrong. The registry replaces prose with **structured, machine-checked workflows**. Every navigation label, route, and permission a workflow names is verified against the live UI model on every CI run.

## Layout

```
src/api/productKnowledge/
  workflows/                 # AUTHORED — one YAML file per workflow
    add_vendor.yaml
    assess_control.yaml
    ...
  workflows.generated.ts     # GENERATED — committed; the engine imports this
src/api/lib/
  workflowRegistry.ts        # types + pure validation + rendering (no YAML at runtime)
scripts/
  generate-workflow-registry.ts   # npm run generate:workflows
  lib/loadWorkflowYaml.ts          # YAML loader (js-yaml) — generator + tests only
```

The engine **never reads YAML at runtime** — it imports `workflows.generated.ts`. YAML is parsed only by the generator and the test (both dev/CI). This mirrors the Application Knowledge Index pattern.

## Schema (one YAML file per workflow)

```yaml
id: add_vendor                 # snake_case; MUST equal the filename stem
title: 'Add a vendor'
goal: 'Add a third-party vendor to your inventory so it can be assessed and monitored.'
permissions: platform          # all | premium | platform | admin (validated)
navigation:                    # menu path as labels; each MUST exist in the index
  - Assets
  - Vendors
routes:                        # concrete page routes; each MUST exist in the index
  - /vendors
  - /vendors/new
ordered_steps:                 # non-empty list of non-empty strings
  - 'Open Assets → Vendors (or go to /vendors).'
  - 'Click "+ Add Vendor" to open /vendors/new.'
expected_result: 'The vendor appears in your inventory, ready to assess.'
common_mistakes:               # list (may be empty)
  - 'Logging a finding before the vendor exists.'
related_workflows:             # ids of other workflows; each MUST exist; no self-reference
  - assess_vendor
```

## Validation rules (enforced by the generator AND `workflowRegistry.test.ts`)

A workflow is rejected (generation fails, CI reds) if any of these fail:

- `id` is missing, not snake_case, duplicated, or ≠ the filename stem.
- `title` / `goal` / `expected_result` are empty.
- `permissions` is not one of `all` / `premium` / `platform` / `admin`.
- `navigation` is empty, or any label is **not in the Application Knowledge Index** (top-level link, dropdown group, or dropdown item).
- `routes` is empty, or any route is **not a real `page.tsx` route** in the index.
- `ordered_steps` is empty or contains an empty step.
- `related_workflows` references a missing workflow or itself.
- The committed `workflows.generated.ts` is **stale** (≠ a fresh load of the YAML).

## How Ask consumes it

`productKnowledge.ts` renders the registry via `renderWorkflows(WORKFLOW_REGISTRY)` into the Ask system prompt — a structured block per workflow (goal, who-can-do-it, where, numbered steps, result, common mistakes, related). There is **no hand-written workflow prose** in `productKnowledge.ts`.

## Adding or changing a workflow

1. Add/edit a YAML file under `src/api/productKnowledge/workflows/` (filename = `id`).
2. Run `npm run generate:workflows` — it validates and rewrites `workflows.generated.ts`. If anything is invalid (bad route, unknown menu label, etc.) it prints the errors and exits non-zero.
3. Commit the YAML **and** the regenerated `workflows.generated.ts`. The `test` lane fails if you forget to regenerate.

## Scope

The registry covers **top-navigation platform workflows** (vendors, AI systems, risks, findings, actions, controls, obligations, evidence, frameworks, briefs, dashboard). Its navigation labels are validated against the Application Knowledge Index, which models the **top nav** (`app/src/lib/navigation.ts`).

**Out of scope (deliberately):** account / billing / subscription / profile / authentication workflows. Their navigation lives in the user menu (not modeled by the index), and those domains are protected — this work changes no billing, auth, entitlement, route, or production behavior. They can be added later once the index models the user menu.

## Related

- `docs/launch/KNOWN_ISSUES.md` D-11 — drift risk and how it's now structurally prevented.
- Application Knowledge Index — `src/api/lib/applicationKnowledgeIndex.ts` + `applicationKnowledgeIndex.generated.ts`.
