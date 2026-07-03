# Enterprise Context / Risk Intelligence — Goal Tracker

Living tracker for the multi-slice mission to complete the Enterprise Context / Risk
Intelligence workstream on `develop`. Re-read the goal + `BUILD_SEQUENCE.md` + the P5
foundation docs at the start of each session, then resume from the item table below.

**Governing invariants (never violated):** `main` FROZEN at `512cfa5a`; everything DARK
behind flags (default off, additive-only); branch off `origin/develop`; feature PRs
squash-merge + delete branch, CI 8/8 green; tenant scoping + inert RLS + `dataClassification`
on every new table; operator-only actions go to the ledger, never performed here; prod
enablement is out of scope (GATE B).

**Merge-strategy note:** PRs #464/#465 were merged with **merge-commits** (operator-directed
at the time, pre-goal). From Slice 3 onward, feature PRs **squash-merge + delete branch**
per the goal.

Last updated: 2026-07-03 (scaffolding + Item 1 recorded).

---

## Item status

| # | Item | Status | PRs / SHAs | Flags | Ledger refs |
|---|---|---|---|---|---|
| 1 | Pre-merge audit of #464/#465; fix Critical/High; merge | **DONE** | #464 (merge `1f308e61`), #465 (merge `7843cf62`); branches deleted | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` (off) | L-1, L-2 |
| 2 | Slice 3 — CSV/spreadsheet import (assets, vendors, apps, AI systems, data stores) | **TODO (next)** | — | (reuses S1 flag) | L-3 (import row-limit value) |
| 3 | Slice 4 — Applicability Engine (deterministic decision fn) | TODO | — | — | — |
| 4 | Slice 5 — Explainability surface | TODO | — | — | — |
| 5 | Slice 6 — Workflow automation (findings/risk/tasks/notifications) | TODO | — | — | — |
| 6 | Slice 7 — Signal→platform linkage (dependency, reassessment, drift) | TODO | — | — | — |
| 7 | UI/CX — context screens, graph view, dashboards | TODO | — | — | L-4 (app build via CI) |
| 8 | Connectors (ServiceNow/Defender/CrowdStrike/Wiz/Tenable/cloud/identity) — dark, mock-tested | TODO | — | per-connector flags | L-5.. (per-connector creds) |
| 9 | Enterprise gating (after GATE A ruling) | **BLOCKED — GATE A** | — | AD-17 capability grant | L-1 |
| 10 | Scale validation (recursive load, EXPLAIN, partitioning) | TODO | — | — | L-6 (staging load env) |
| 11 | Governance docs → as-built (CANONICAL, arch, runbooks, rollback) | IN-PROGRESS | this PR (scaffolding) | — | — |

### Decision gates
- **GATE A** (before Slice 9): Platform-vs-Enterprise access model + AD-17 capability-grant shape + entity/edge caps. **Simmee ruling required.** Prepare options/tradeoffs, then STOP and ask. Not yet reached (Slices 3–8 come first).
- **GATE B** (absolute): nothing enabled in production under this goal, ever. GA enablement is outside this goal's authority.

---

## Item 1 — Pre-merge audit (DONE)

**Scope:** independent architecture + security audit of PRs #464 (ECL Slice 1) and #465
(ECL Slice 2 + 2b: relationship graph + resolver), before merge to `develop`.

**Findings + resolution (all fixed on-branch before merge):**
- **C1 (Critical, governance):** `BUILD_SEQUENCE.md` still read docs-only / P4-gated while the
  code was built. Reconciled with a BUILD AUTHORIZATION block recording the operator's
  explicit ECL S1/S2 build authorization + P4-gate waiver.
- **F1 (High):** DELETE handlers returned `204 + res.send()`; under `asTenant` the
  buffering proxy throws on `send()` → rollback + false audit event. Fixed → `200 + json`.
- **F3 (Medium→fixed):** the live app-layer defense (handler org-scoping) had no test — the
  isolation tests only exercised raw SQL (which is why F1 slipped). Added 16 handler-level
  cross-org negative-path tests (entities, relationships, graph seed → 404; DELETE → 200 JSON).
- **No Critical security findings; no cross-tenant leak.** RLS shape, grants, flag gating,
  SQL-injection surface, and graph-traversal isolation all verified correct.

**Deferred to prod-enable gate (NOT merge blockers — recorded in BUILD_SEQUENCE + ledger):**
- **H1:** companion edge cap on `enterprise_relationships` (edge write path unmetered).
- **H2:** graph resolver load test at enterprise fan-out (per-path recursive-CTE blow-up risk;
  materialized-adjacency fallback designed, not built).
- **AD-17:** `requireEntitlement("premium")` reaches every rank-4 org (can't distinguish
  Enterprise from Platform/Team) → GATE A.

**Result:** both PRs merged to `develop`, flag-inert; branches deleted; `main` unchanged.

---

## As-built on develop (Slices 1–2)
- **Slice 1:** `enterprise_entities` header + `enterprise_data_stores` typed child (migrations
  `20260717`–`20260719`) + `organizations.max_enterprise_entities` cap (separate counter) +
  inert RLS + `app_request` grant; flag/metering/validator libs; org-scoped CRUD; tests;
  GDPR classification; CANONICAL registration.
- **Slice 2 + 2b:** `enterprise_relationships` edge (migrations `20260720`–`20260721`) + inert
  RLS + grant; edge CRUD (two-endpoint same-org pre-flight, soft-delete); read-time bounded
  graph resolver `GET /api/enterprise-graph` (repo's first `WITH RECURSIVE`; AD-13 union of
  generic edges + `ai_system_vendor_dependencies`).

## Known governance-hygiene items (Item 11 backlog)
- `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` is **not declared in `render.yaml`** (0 occurrences).
  Strict `=== "true"` means it is still OFF everywhere, but rule 2 wants it declared with an
  explicit safe value (`false`) per service. **To bundle into the Slice 3 PR** (code change,
  inert; not operator-only).
- `BUILD_SEQUENCE.md` Active-package line still reads "Priority 4 ACTIVE"; ECL S1/S2 are merged.
  Update the active-workstream record as part of Item 11 / next slice.
