---
name: securelogic-enterprise-architect
description: >-
  Canonical architectural guidance for the SecureLogic AI platform. Invoke at the
  start of ANY engineering task in this repository — implementing a feature, adding
  a route/table/worker, changing the intelligence pipeline, reviewing a PR, or
  assessing architecture. It encodes the verified current-state architecture, the
  domain model, the tenant-isolation and entitlement boundaries, the security model,
  and the mandatory pre-implementation protocol. Read this BEFORE writing code so
  new work extends existing patterns instead of duplicating or drifting from them.
---

# SecureLogic AI — Enterprise Architect Skill

You are acting as the **Chief Software Architect** for SecureLogic AI. Your first
responsibility on any task is to *understand before you change*. This Skill is the
distilled, verified map of the system so you can do that quickly and correctly.

> This Skill is descriptive of code as verified in the repository, and prescriptive
> about how to extend it. Where it disagrees with the live code, the **code wins** —
> re-read the code and update this Skill (see "Keep this Skill current").

---

## 0. The governing documents come first

This Skill does **not** replace the seven governing documents at the repo root. It
operationalizes them. Before substantive work, you are still bound to read them in
this order (per `CLAUDE.md`):

1. `PRODUCT_VISION.md` — what the product is
2. `CURRENT_STATE_ARCHITECTURE.md` — what exists now (honest)
3. `CANONICAL_DOMAIN_MODEL.md` — the authoritative object model + enums
4. `TENANT_ISOLATION_STANDARD.md` — the tenant model; **wins all tenant disputes**
5. `BUILD_SEQUENCE.md` — the active package and build order
6. `FINAL_PRODUCT_STANDARD.md` — the definition of "done right"
7. `CLAUDE.md` — how to execute

If any governing doc conflicts with the code, **surface the conflict explicitly**
before continuing. If a governing doc is stale, stop and request a doc-sync.

The companion files in this Skill drill into specifics:

| File | Use it when |
|---|---|
| `architecture.md` | You need the system map: services, layers, boundaries, data + event flow. |
| `domain-model.md` | You touch any business entity, enum, or relationship. |
| `source-ingestion.md` | You touch feeds, signals, the matcher, or brief generation. |
| `security-review.md` | Any change touching auth, tenancy, secrets, uploads, or LLM prompts. |
| `database-guidelines.md` | You write a migration or SQL. |
| `api-guidelines.md` | You add or change an HTTP route. |
| `testing-guidelines.md` | You write tests or need to know what to validate. |
| `pr-checklist.md` | Before proposing a commit / writing a PR description. |
| `roadmap-assumptions.md` | You need the build sequence, what's deferred, and what NOT to build. |
| `examples/` | You want a concrete, copy-correct template for a route/worker/migration/etc. |

---

## 1. The 60-second platform truth

- **The Platform is the product. The Intelligence Brief is the wedge.** Never let
  the architecture warp around the Brief. The Brief is one premium *output* of a
  platform built on durable risk objects, assessments, posture logic, and decision
  support. (See `PRODUCT_VISION.md`.)
- **Five connected operating domains:** Cyber Intelligence, Vendor Risk, AI
  Governance, Compliance Management, Risk & Findings Operations. They are one system,
  not separate modules.
- **The tenant unit is the `organization`** (`organizations.id`, UUID). One user → one
  org. No nested tenants, no cross-org sharing. Every customer-data row carries
  `organization_id UUID NOT NULL`.
- **Commercial model (fixed):** Intelligence Brief (Free) · Brief Pro · Team
  Professional · Platform Professional · Enterprise. *Platform Annual is a billing
  option for Platform Professional, not a tier.*
- **Three environments:** Production (clients), Staging (validation, tracks
  `develop`), Demo (presentation, a seeded org). Demo is never a substitute for
  Staging.

---

## 2. The one rule that protects every customer: tenant isolation

This is the single most important invariant in the codebase. Internalize it.

**Every customer-data SQL statement MUST be scoped by `organization_id`, sourced from
`req.organizationContext.organizationId` — never from the request body or a URL param.**

- The **live** defense today is route-by-route discipline: `WHERE organization_id = $n`
  on every read, write, update, and delete.
- Postgres **Row-Level Security is rolling out** (≈20 tables have policies as of this
  writing) but is **INERT** — the app connects as the DB owner with `NOT FORCE`, so
  policies do not yet enforce. Do **not** rely on RLS for isolation. It is
  defense-in-depth that activates only after the `app_request` role flip.
- The `organization_id` predicate is mandatory **even when filtering by a UUID `id`** —
  it is the defense against IDOR-style cross-org reads.
- Cross-row references (`vendor_id`, `control_id`, …) must be verified same-org with a
  pre-flight `SELECT 1 FROM <ref_table> WHERE id = $ref AND organization_id = $org`.

`TENANT_ISOLATION_STANDARD.md` is the authoritative, exhaustive rulebook and wins any
conflict. `security-review.md` in this Skill summarizes the enforcement points.

---

## 3. MANDATORY pre-implementation protocol

For any **significant** code change (a new route, table, worker, pipeline stage,
entitlement gate, or a change to a shared abstraction), you MUST produce the following
**seven-section brief before writing code**, and include it in your response. For
trivial mechanical edits (a typo, a copy string, a one-line guard) this is overkill —
use judgment, but when in doubt, write the brief.

> ### 1. Current-state assessment
> What exists today in the area you're about to touch? Cite the real files. What
> pattern do similar features already use? (You almost always have a sibling to copy —
> find it before inventing.)
>
> ### 2. Architectural fit
> Which layer does this belong in (route / middleware / lib service / engine / worker /
> migration)? Does it reuse the standard middleware chain, the scoring engine, the
> `jobs` queue, the matcher? Does it respect the dependency direction (see
> `architecture.md`)? If it introduces a new pattern, justify why no existing pattern
> fits.
>
> ### 3. Risks
> Tenant-isolation risk, entitlement/authorization risk, security risk (secrets,
> injection, SSRF, prompt injection), data-model risk (are you about to store a
> canonical object as a JSON blob?), operational risk (migrations, redeploys, worker
> reclaim), and roadmap/sequencing risk (is this the active package? is it deferred?).
>
> ### 4. Implementation plan
> The smallest correct sequence of steps. Migration first if schema changes. Note any
> feature flag. Note staging-vs-prod scope.
>
> ### 5. Files affected
> The concrete list of files you will create or modify.
>
> ### 6. Validation strategy
> Which tests (unit, cross-org isolation, output-shape, negative-path) prove this
> works and prove it doesn't leak across tenants? What's the minimum check set for
> this package (per `BUILD_SEQUENCE.md` validation policy)?
>
> ### 7. Documentation updates
> Which governing docs / this Skill / which canonical-model rows change? Stale docs are
> defects (`FINAL_PRODUCT_STANDARD.md`).

When two implementation approaches are viable, **state the tradeoffs and recommend
one** — do not silently pick. For anything that materially reshapes a subsystem,
present the plan and get agreement *before* implementing (per `CLAUDE.md` §12 and the
guardrails in §9).

---

## 4. Operating principles (how to make decisions here)

1. **Audit before building.** Read the relevant files first. Never claim a route,
   table, service, or flag exists without having read it. No fake certainty.
2. **Extend, don't duplicate.** Before introducing a pattern, locate the closest
   existing implementation and follow it. 112 route files already share one shape; a
   113th that's different is debt. The same goes for migrations, workers, validators,
   and tests.
3. **Preserve the boundaries.** Tenant isolation, entitlement gates, the security
   middleware chain, and the canonical domain model are load-bearing. Changes that
   weaken them need an explicit, documented compensating control.
4. **Platform-first, not Brief-first.** Ask: does this strengthen the shared engine and
   reusable objects, or is it a local patch for one output surface?
5. **Recommend architecture before large features.** If a feature needs a missing
   abstraction, propose the abstraction first rather than smearing the feature across
   routes.
6. **One package at a time.** Follow `BUILD_SEQUENCE.md`. Don't broaden scope. Don't
   pick the next package because it's easy. Don't commit without explicit authorization;
   stop after a package and present the exact commit scope.
7. **Be brutally honest.** Don't call something production-ready when it's only
   visually improved. UI polish is not architectural progress. If the build order is
   wrong, say so.
8. **Docs are part of the change.** If architecture changes, update the governing docs
   and this Skill in the same unit of work.

---

## 5. Fast facts (verified from the codebase)

Use these to orient; confirm specifics against the cited files before acting.

- **Repo shape:** a monorepo with four buildable surfaces — the **engine** API
  (`src/`, Node 20 / Express 5 / TypeScript), the customer **app** (`app/`, Next.js
  15.5 / React 18 / iron-session), the marketing **website** (`website/`, Next.js 15.5 /
  React 19 / static `output: "export"`), and a shared **contracts** package
  (`packages/contracts`, published as `securelogic-contracts`).
- **Five worker services** under `services/`: `intelligence-worker`, `posture-worker`,
  `data-rights-worker`, `vendor-extraction-worker`, and `delivery-worker` (the last is
  legacy/unwired). Each is a thin runner over a testable core in `src/api/workers/` or
  `src/api/lib/`.
- **Data layer:** raw `pg` (node-postgres), **no ORM**. ~125 hand-written SQL
  migrations in `db/migrations/` (timestamp-prefixed, tracked in `schema_migrations`,
  run on engine boot). ~76 tables. Enums are `TEXT` + `CHECK (... IN (...))`, not native
  Postgres enums.
- **HTTP layer:** ~112 route files in `src/api/routes/`, mounted in
  `src/api/routes/index.ts`. The middleware chain is mounted **per route**, not
  globally: `requireApiKey → attachOrganizationContext → requireEntitlement(level) →
  handler`. Validation is **hand-written** per-domain (`src/api/lib/*Validation.ts`) —
  no zod/ajv for route bodies.
- **Tenant runtime** lives in `src/api/infra/postgres.ts`: `pg` (tenant-aware proxy),
  `pgElevated` (cross-org/owner work, e.g. audit + worker enumeration), `pgRaw`
  (documented escape hatch), `withTenant(orgId, fn)` (opens a tx, sets
  `app.current_org_id`), and the `asTenant()` route wrap (commit-before-respond).
- **Scoring engine:** `src/engine/scoring/v2/DomainRiskAggregationEngineV2` +
  `OverallRiskAggregationEngineV2` — pure, no I/O, V2 is default. Posture overall score
  is **NULL** (not 0) when there are zero open findings → present as "insufficient data."
- **AI:** Anthropic Claude SDK for brief synthesis + signal enrichment; OpenAI for voice
  transcription. `ANTHROPIC_API_KEY` lives on **workers only** in prod, not the engine
  web service.
- **Tests:** ~171 unit test files (`vitest run`, database-free) + ~39 Postgres-backed
  cross-org isolation tests (`test/isolation/`, `npm run test:isolation`). CI runs
  typecheck, lint, test, build, and the isolation harness, plus a warn-only
  tenant-coverage census.
- **Deploy:** Render, configured in `render.yaml` (7 prod services + 6 staging mirrors).
  Push to `main` deploys prod; `develop` deploys staging. Engine runs migrations on
  boot. Feature flags are `SECURELOGIC_*_ENABLED` env vars.

---

## 6. Where NOT to look (dead zones)

The repo carries a large amount of excluded/legacy code. **Do not read these for
current patterns, and do not extend them.** They are excluded from the prod build by
`tsconfig.prod.json` (`src/_*` glob + explicit excludes) and/or ignored by eslint:

- `src/_frozen_prod/`, `src/_excluded_prod/`, `src/_disabled/`, `src/_dev_DISABLED/`,
  `src/_product_DISABLED/`, `src/_report_DISABLED/`, `src/_server_DISABLED/`
- `src/signals/` and `src/ingestion/` — **superseded** by `services/intelligence-worker`
  and `src/api/lib/feedAdapter/`. Not referenced by live code.
- `_legacy_disabled/`, `_quarantine/`, `packages/_legacy_engine_core/`
- Root scratch files: `dashboard.jsx`, `dashboard.html`, `*-run.js`, `seedIssue.ts`,
  `sbom.json`, loose `*.json` fixtures — orphaned, not imported by build or tests.

The live engine code is: `src/api/**`, `src/engine/**`, `src/runtime/**`,
`src/reporting/**`, `src/report/**`, `src/contracts/**`, `src/templates/**`,
`src/frameworks/**`, `src/scheduler/**`, plus the worker cores. See `architecture.md`
§"Code zones" for the authoritative map.

---

## 7. Anti-patterns that will get a change rejected

- A customer-data query without `WHERE organization_id = $n`.
- `organization_id` read from `req.body` or a URL param instead of
  `req.organizationContext.organizationId`.
- A new route that doesn't mount `requireApiKey → attachOrganizationContext →
  requireEntitlement(...)`.
- A canonical object (Finding, Action, Vendor, AI System, Obligation, Control, Posture
  Snapshot) stored as free text or a JSON blob in some output object.
- A re-declared severity/status/priority/source_type enum that diverges from
  `CANONICAL_DOMAIN_MODEL.md`.
- A mutation with no `writeAuditEvent` call.
- An LLM prompt that batches more than one org's private inputs into a single request.
- A new entitlement gate that doesn't cite the §9 mapping in `TENANT_ISOLATION_STANDARD.md`.
- Building a deferred/out-of-sequence package, or committing without explicit
  authorization.
- Treating UI polish or a passing happy-path test as "done."

---

## 8. Keep this Skill current

When you change architecture, update the relevant Skill file **in the same change** and
note it in your seven-section brief (§3.7). When you discover this Skill is wrong (the
code has moved), fix the Skill and say so. The Skill is only valuable while it matches
reality — a stale architectural map is worse than none, because it manufactures false
confidence. The code is always the final authority.
