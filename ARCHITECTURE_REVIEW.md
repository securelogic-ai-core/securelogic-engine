# ARCHITECTURE_REVIEW.md

**SecureLogic AI — Full Platform Architecture Review (Sprint 3C)**
Date: 2026-07-01 · Branch reviewed: `fix/ask-secondary-nav-knowledge` (≡ `develop` + one merged commit) · Method: read-only audit, no code changed.

> Reviewed like a Fortune-100 principal architect, and scored against the platform's own
> `FINAL_PRODUCT_STANDARD.md`, not a generic bar. Every finding is grounded in real files
> (`path:line`). Five parallel reviewers covered architecture/boundaries, security boundaries,
> dead-code/structure, dependencies/build/DX, and API-surface/complexity/scaling. Where reviewers
> disagreed, the conflict was re-verified by hand (see Appendix A).

---

## 0. Scope & method

- **In scope (verified against code):** the active backend — `src/api/` (Express engine, 112 route modules) and `src/engine/` (risk/assessment engine); the Next.js BFF `app/src/app/api/` (59 handlers) and its engine client `app/src/lib/api.ts`; build/CI/deploy topology (`render.yaml`, `.github/workflows/ci.yml`, `tsconfig*`); dependencies; dead-code/quarantine trees; DB migrations for domain-model fidelity.
- **Excluded from behavioral assessment:** the marketing `website/`, deep app UI/UX quality, and the quarantined trees (`src/_frozen_prod`, `src/_excluded_prod`, `src/*_DISABLED`, `_quarantine`, `_legacy_disabled`) except to classify them as debt.
- **Codebase size:** ~712 active `src/` TS files vs. **~360 git-tracked dead/quarantined files**; `app/src` ~5,900 TS/TSX; 13 Render services (6 prod + 6 staging + 1 unpaired), 4 worker build targets.

---

## 1. Architecture Score

### Overall: **5.5 / 10 — "C+"**
**The runtime skeleton is enterprise-viable; the codebase organization, packaging-enforcement, and technical-debt posture are not yet.**

The live-serving architecture is healthier than the repository that contains it. The security middleware chain is consistent and per-route, tenant isolation is a real (route-level) discipline, the Next.js layer is a genuinely thin proxy with **no duplicated domain logic**, and the canonical domain objects are all first-class org-scoped tables. Those are worth protecting. But the codebase is carrying the scars of repeated restructuring (parallel stale directories, ~360 dead tracked files), the commercial model that funds the platform is **not expressible** by the entitlement gate, scoring authority is split in two, the intelligence pipeline collapses into god-objects that are also the scaling ceiling, and 3 of 4 worker build targets are unguarded by CI.

### Scorecard (per requested dimension)

| Dimension | Score | One-line basis |
|---|:--:|---|
| Application architecture | 6 | Healthy skeleton; god-objects, no service layer between HTTP and DB |
| API architecture | 6 | Clean BFF + consistent security chain; fat routes, no envelope/validation |
| Folder structure | 3 | Parallel stale dirs (`report`/`reports`/`reporting`), ~360 dead tracked files, root clutter |
| Dependencies | 5 | Redundant libs (2 hashers, 2 LLM SDKs), phantom `jest` config, `@types/node` drift |
| Naming | 6 | Internally consistent per-tree; cross-tree split; misleading `_frozen_prod` name on live tests |
| Boundaries | 7 | Express↔Next boundary is clean (no logic dup); weakened by 5-location contract sprawl |
| SOLID | 4 | God-objects fuse routing + SQL + LLM + email + posture in single files |
| Duplication | 5 | Little *logic* dup; but concept dup (two `signal` tables), ~160 hand-copied types, parallel dirs |
| Dead code | 2 | ~360 tracked dead files; `packages/_legacy_engine_core` (109), quarantine clusters (~310) |
| Complexity | 4 | 16 active files >800 LOC; `app/src/lib/api.ts` 4,362; `cyberSignals.ts` 2,171 |
| Coupling | 6 | Thin proxy = low cross-service coupling; very high *intra*-file coupling in god-objects |
| Feature organization | 4 | Organized by technical layer; a single workflow is smeared across 8+ files |
| Scaling | 5 | Sequential per-org fan-out, in-memory global rate limiters, unconfigured pg pools |
| Performance | 6 | Feeds fetched once globally, pagination mostly cursor-based; pool/limiter gaps |
| Maintainability | 4 | God-files, no shared validation/envelope, contract desync risk, debt load |
| Security boundaries | 7 | Tenant isolation real, no committed secrets, chain consistent; entitlement + one fail-open + legacy unscoped table |
| Developer experience | 4 | Destructive stale scripts, phantom config, doc/root clutter; offset by a real README |
| Technical debt | 3 | Huge quarantine, parallel structures, restructuring scars still tracked |

*(Scores are grounded judgments, not precise metrics; they exist to prioritize, not to grade for its own sake.)*

---

## 2. What is genuinely strong (preserve — do not "fix")

These were verified by reading imports and code, not just names. Per repo culture, they should be defended against regressions:

- **Consistent per-route security chain**, mounted per-route (not global): `requireApiKey → attachOrganizationContext → requireEntitlement → asTenant(handler)` (verified `risks.ts:241-244`, `assess.ts:265-267`; the three gates mount across ~68–75 route files). `requireApiKey` fails **closed** on the JWT password-rotation DB check (`requireApiKey.ts:84-101`).
- **Tenant isolation is a real live defense.** All spot-checked routes (`vendors`, `risks`, `controls`, `aiSystems`, `assessments`, `dataExports`) source org from `req.organizationContext.organizationId` and carry `WHERE organization_id = $n` on every read/write. RLS is correctly treated as **inert pre-flip** (owner cred, `NOT FORCE`) — the WHERE-scoping is the actual guard.
- **`app/` is a clean thin BFF.** 0 files in `app/src/app/api` import `pg`/an ORM; 56/59 handlers `fetch` the engine or use `@/lib/api`; the JWT lives only in an HttpOnly `iron-session` cookie and never reaches browser JS. **No domain logic is duplicated across the boundary.**
- **Domain-model structural fidelity is high.** organizations, vendors, controls, risks, obligations, `cyber_signals`, findings, actions, ai_systems, assessments, posture_snapshots are all first-class org-scoped tables; `intelligence_brief_items` reference signals by FK rather than embedding them.
- **The posture engine boundary is pure.** `postureComputation.ts` maps DB rows into the engine's `EngineInput`; the V2 aggregation engines do no I/O; overall posture is `NULL` (not `0`) on zero findings (`postureComputation.ts:135`).
- **Secrets discipline in git is clean.** No live secret is tracked; `.gitignore` covers `*.pem`/`keys/`/`*-keypair.json`/`.env`; `validateEnv.ts` enforces required prod secrets at boot; `render.yaml` has 130 `sync:false` and zero inline secret literals.
- **SSRF pinning** on outbound webhooks (`webhookUrlSafety.ts:155`, IPv4-mapped-IPv6 bypass handled) and **low TODO/FIXME density** (1 hit across active `src/api`+`src/engine`+`runtime`) — the debt is in structure, not litter.

---

## 3. Critical Issues

### C1 — The entitlement gate cannot enforce the 5-tier commercial model; it is effectively binary
`requireEntitlement` collapses every tier into three ranks and explicitly maps `premium | platform | team` all to `premium` (`src/api/middleware/requireEntitlement.ts:5-10,31-36`). Call-site census: **215 gates are `"premium"`**, 19 `"standard"`, 1 `"professional"`, 1 `"starter"`. So **Brief Pro vs Team Professional vs Platform Professional vs Enterprise are indistinguishable at the API layer** — any paid-premium org clears essentially every gated route. The commercial packaging that `CLAUDE.md`/`FINAL_PRODUCT_STANDARD.md` say funds the platform has **no enforcement primitive**; tier differentiation currently lives only in UI/marketing.
**Impact:** monetization/packaging boundary unenforced; a Team-tier credential can reach Platform-tier routes.
*Honest caveat:* if tier differentiation is deliberately feature-flag-level rather than route-level, this is "High." It is ranked Critical because the mechanism **as written cannot express the five tiers at all**.
**Fix direction:** give `requireEntitlement` named per-tier ranks (or a capability map) that can distinguish `teams`/`platform`/`platform_annual`/enterprise before any route relies on the distinction.

### C2 — 3 of 4 worker build targets are unguarded by CI (deploy-break class)
`render.yaml` builds four workers, each with its own `tsconfig`/`dist-*`: intelligence (`:337`), posture (`:506`), data-rights (`:585`), vendor-extraction (`:699`). The CI `build` job (`.github/workflows/ci.yml:90-101`) compiles **only** engine + intelligence-worker. The inline comment at `ci.yml:92-99` documents that a worker type-error once passed PR CI but broke the worker **deploy** ("red for a day") — yet the fix added only the intelligence-worker step. **posture / data-rights / vendor-extraction remain exactly that failure class:** a shared-type drift passes PR CI and fails the Render `tsc -p …` deploy.
**Impact:** a green PR can break a production worker deploy; the gap is in the highest-blast-radius part of the pipeline.
**Fix direction:** add three `npx tsc -p services/<worker>/tsconfig.json` steps to the `build` job (mirror `ci.yml:100-101`).

---

## 4. High

### H1 — Two parallel scoring worlds; `src/engine` is central for posture only, bypassed for signal/risk/vendor scoring
`src/engine` is imported by exactly **two** files in `src/api` (`routes/assess.ts:7`, `lib/postureComputation.ts:25-26`). Posture scoring *is* correctly centralized. But signal/risk/vendor scoring runs a **separate ad-hoc engine set in `src/api/lib`** that never touches `src/engine`: `riskScoring.ts`, `signalTargetMatching.ts`, `actionRecommendationEngine.ts`, `riskScore.ts`, `vendorRiskScore.ts`, `workflowScoringIntegration.ts`. The "shared risk engine at the center" mandate (`CLAUDE.md §10`) holds for assessments/posture but **not** for the intelligence pipeline — two scoring authorities with divergent formulas and no shared contract.

### H2 — God-object: `cyberSignalProcessingService.ts` (1,395 lines) fuses four layers
Vendor-name canonicalization (`:144,:204`) + the matcher runner `runMatcherForSignal` (`:283`) + side-effect persistence of `findings`/`actions`/`signal_match_suggestions` (`:440,:499,:579`) + an entire bolted-on posture-snapshot subsystem `computeAndPersistPostureSnapshot` (`:1132`, writing `posture_snapshots` `:1306` and `domain_scores` `:1364`) — business logic + raw SQL + `pgElevated` transaction management + a downstream LLM call (`:1099`) in one file. Untestable in isolation, high blast radius, the natural sink for future drift. (The pure scorer `signalTargetMatching.ts` *is* correctly extracted — the runner is what's trapped.)

### H3 — The daily intelligence pipeline is a monolith **and** the primary scaling ceiling
`briefScheduler.ts` (1,102 lines) *is* the pipeline instead of composing it: fetches 7 external feeds (`:607-737`), normalizes + inserts `cyber_signals` (`:165`), generates + persists briefs (`:282,:445`), runs LLM synthesis (`:385`), and dispatches email (`:1062`). Worse, the per-org loop is **fully sequential** — `:796` "Process each org sequentially" then `:798 for (const orgId of orgIds)` with `await ingest → generate → sendBrief` inside, **no `Promise.all`, no concurrency cap**. Feeds are fetched once globally (good), but ingest+generate+send are **O(orgs × feeds) sequential awaits**: runtime grows linearly with tenant count and one slow/failing org delays every downstream org's brief.

### H4 — Duplicate "signal" concept: a legacy **un-scoped** `signals` table is still actively served
`signals` (`db/migrations/001_securelogic_platform.sql:95`) has **no `organization_id`** and is still served by `src/api/routes/signals.ts:39` (`FROM signals`), backing the newsletter/insights/trends path. The canonical object is the org-scoped `cyber_signals` (`20260430_cyber_signals_ingestion.sql:36`). Two live tables model "signal" with incompatible tenancy — a one-concept-two-objects violation and a **latent cross-tenant exposure surface** (the un-scoped table cannot be RLS-scoped and any future auth'd read of it leaks across orgs).

### H5 — `findings.severity` — the field the domain model most insists must be structured — has no DB CHECK
`findings.severity` is `TEXT NOT NULL` with no constraint (`001_securelogic_platform.sql:61`); no later migration adds one. The Severity enum is enforced **only** in app code (`findingValidation.ts:39-44`). Any writer bypassing the validator (worker, backfill, future route) can persist an off-enum severity that silently breaks scoring and heatmaps.

### H6 — Global and webhook rate limiters use in-memory stores (per-replica, not cluster-wide)
Per-API-key *tier* limiting is correctly Redis-backed (`tierRateLimit.ts`). But the **global** limiter (`app.ts:232`, `max:300/min`), `slowDown` (`:238`), and the **Stripe-webhook** limiter (`:306`, `max:200`) configure **no `store` → express-rate-limit default MemoryStore**. Effective ceiling = `replicas × max per IP`; the intended global/abuse protection weakens as the service scales out. Redis is already wired (`infra/redis.ts`) — the store just isn't attached here.

### H7 — ~360 git-tracked dead files and multiple stale parallel structures
Truly-dead, unreferenced by active code and outside `tsconfig.prod.json`'s include set: quarantine clusters (`_excluded_prod` 113, `_server_DISABLED` 33, `_report_DISABLED` 12, `_disabled` 10, `_product_DISABLED` 7, `_dev_DISABLED` 1, `api/_disabled_v1` 2, root `_quarantine` 19, `_legacy_disabled` 4 ≈ **201 files / ~3,600 LOC**) plus **`packages/_legacy_engine_core` (109 files, superseded by `src/engine`)**. Parallel stale dirs from repeated restructuring: `src/report` (0 importers) & `src/reports` vs authoritative `src/reporting` (17 refs); root `contracts/`, `schemas/`, `frameworks/` vs their `src/` counterparts; empty tracked `src/schemas`. Committed `.bak`/`.save` source (`EngineResultBuilder.ts.save`, 3 `*.ts.bak`) and two `*.yml.disabled` workflows. **~360 files are deletable/untrackable without touching the prod build.**

---

## 5. Medium

- **M1 — Contract sprawl; the "shared" package is dead; types are hand-copied across the boundary.** Contract defs live in 5 locations: `contracts/` (3), `src/contracts/` (5), `src/api/contracts/` (2), `src/engine/contracts/` (26, used), `packages/contracts/src/` (55, imported by **zero** files in `src`/`app`/`services`). The Next.js app re-declares ~160 response interfaces by hand in `app/src/lib/api.ts` — an engine response-shape change silently desyncs the app. No single source of truth for the API contract.
- **M2 — Layer-oriented organization → fat routes, no service layer.** `src/api/lib` is 125 flat files; `src/api/routes` is 112 flat files with domain grouping *faked* by filename prefix (28 `admin*`, 6 `risk*`, 5 `vendor*`). Routes embed raw SQL + Stripe + LLM directly (e.g. `billing.ts:35,54,332`). This is the **root cause of H2/H3**: no service layer between HTTP and `pg`/SDKs.
- **M3 — God-files beyond the pipeline.** 16 active files exceed ~800 LOC; standouts: `app/src/lib/api.ts` (4,362 — hand-maintained engine client), `cyberSignals.ts` (2,171, 13 fat POST actions), `vendorAssuranceDocuments.ts` (1,734), `risks.ts` (1,509), `customerAuth.ts` (1,295, 12 auth flows).
- **M4 — pg pools are unconfigured.** `postgres.ts:29` and the `pgElevated` pool (`:50`) set no `max`/`idleTimeoutMillis`/`connectionTimeoutMillis` → pg default **max=10** each; on multi-replica this is `replicas × 20` connections with no tuning and no timeout backpressure.
- **M5 — No shared request validation and no response envelope.** zod is absent from all 112 route files (only 2 lib files use it); validation is hand-rolled per route. ~2,000 raw `res.status().json()` calls vs 17 uses of a `respond()` helper — error bodies are ad hoc.
- **M6 — Enum divergence between DB constraints and `CANONICAL_DOMAIN_MODEL.md`.** `findings.source_type` includes `cyber_signal`; `actions.source_type` includes `obligation` (`20260628_...:18`) — neither in the canonical lists. Two `criticality` vocabularies (`vendors`/`ai_systems` lowercase `medium` vs `dependencies` PascalCase `Moderate`) and two `likelihood` vocabularies (`findings` `very_high…` vs `risks` `very_likely…rare`). Cross-object aggregation must special-case per table. Stale docs are defects per `FINAL_PRODUCT_STANDARD.md §Docs`.
- **M7 — Redundant/overlapping dependencies (engine).** Two password hashers (`argon2` + `bcryptjs`), two LLM SDKs (`@anthropic-ai/sdk` + `openai` — README declares Anthropic; confirm `openai` isn't vestigial), two datastores (`pg` + `better-sqlite3` — confirm sqlite is test-only), `exceljs` duplicated engine+app. An `overrides` block already force-bumps 5 transitive deps — vuln whack-a-mole.
- **M8 — `requireAuth` fails OPEN where `requireApiKey` fails CLOSED (same control).** The `password_changed_at` re-check is `try{…}catch{/* fail open */}` in `requireAuth.ts:54-58` but fails closed with an audit event in `requireApiKey.ts:84-92`. During a Postgres blip, a JWT stolen before a victim's password reset stays usable on `requireAuth`-guarded routes. Narrow, defense-in-depth — but an inconsistent posture for the same control.
- **M9 — Local key material sits unencrypted in the working tree.** `issue.private.pem`, `keys/issue-signing-private.pem`, `engine-keypair.json` contain **real** RSA-4096/Ed25519 private keys (not placeholders). **Not** a git leak (untracked, 0 commits in history — see Appendix A), but compromise-if-host-compromised. Confirm prod signing uses a distinct KMS-managed key; if any of these ever ran in prod, rotate.
- **M10 — `npm audit` gate can't catch the outstanding vulns.** CI `audit` runs `--audit-level=high` (`ci.yml:78`); the 2 open Dependabot alerts are **moderate** → green by design while they stand.
- **M11 — Dependency/toolchain drift & cruft.** Engine `typescript ~5.9.3` + `@types/node 25` (ahead of the Node ≥20 runtime) vs app `typescript ^5.5` + `@types/node 20`. Dead `tsconfig.backup.json` and unreferenced `tsconfig.paths.json`. Dual contract source (published `securelogic-contracts` **and** local `packages/contracts`).

---

## 6. Low

- **L1 — `src/api/routes/signals.ts:42`** hardcodes `LIMIT 50` with no cursor — the signals list silently caps and cannot page (mirror the vendors/controls cursor pattern already in-repo).
- **L2 — Transitive-only org scoping** on `requirements`/`control_mappings`/`obligation_mappings` (parent-FK, not direct `organization_id`) — documented, but blocks direct RLS and relies on join integrity.
- **L3 — `attachOrganizationContext` fails open to a null org context** (`:28-37`) rather than 401; downstream `requireEntitlement` catches it (defaults `starter`), so no live hole — but a latent footgun for any future route mounting context without an entitlement gate.
- **L4 — `jest.config.js` is a phantom framework** — `ts-jest`/`jest` are not installed; vitest is the only real runner. Misleads onboarding; delete.
- **L5 — Destructive stale scripts** `hard-reset.sh`, `reset-structure.sh`, `fix-imports.sh` (root, executable) rewrite a directory layout that no longer exists; running one would corrupt the tree. Delete.
- **L6 — Root clutter (22 tracked stray files):** shell-accidents (`=`, `c.id`, `node`, `tsc`, `^C`, `type-errors.log`), `*.save`, and misplaced fixtures/blobs (`dashboard.jsx` 68 KB, `sbom.json` 1.1 MB, `input.json`, `test*.json`, `explained.v*.json`). Most are already gitignored but were committed before the rule → still tracked until `git rm --cached`.
- **L7 — Naming convention split:** `src/api` is camelCase (~333 files), `src/engine` is PascalCase (87 files) — internally consistent, mutually inconsistent, no repo-wide standard.
- **L8 — Orphaned `services/delivery-worker/`** (zero `render.yaml` refs; workflow is `.disabled`), empty tracked `src/schemas/`, and dormant Lemon Squeezy code still imported-in-comments in `app.ts:55-60`.

---

## 7. Quick Wins (low-risk, high-signal; each independently shippable)

| # | Action | Evidence | Payoff |
|---|---|---|---|
| 1 | Add posture/data-rights/vendor-extraction `tsc` steps to CI `build` | `ci.yml:100-101` | Closes **C2** deploy-break gap |
| 2 | Attach the existing Redis store to the global/webhook limiters | `app.ts:232,238,306` | Fixes **H6**, cluster-wide limits |
| 3 | Set `max`/`idleTimeoutMillis`/`connectionTimeoutMillis` on both pg pools | `postgres.ts:29,50` | Immediate scaling headroom (**M4**) |
| 4 | Bound the `briefScheduler` org loop with a small `p-limit` concurrency cap | `briefScheduler.ts:798` | Large wall-clock win, no arch change (**H3** interim) |
| 5 | Add the `findings.severity` CHECK constraint (migration) matching the validator | `001_...:61`, `findingValidation.ts:39-44` | Closes **H5** data-integrity hole |
| 6 | Add cursor pagination to `signals.ts` GET | `signals.ts:42` | Fixes **L1** |
| 7 | Delete `jest.config.js`, `hard-reset.sh`, `reset-structure.sh`, `fix-imports.sh` | roots | Removes footguns/phantom config (**L4/L5**) |
| 8 | `git rm --cached` the ~11 gitignored-but-tracked shell-accident/`.save` files | root | Reduces accidental-`git add -A` risk (**L6**) |
| 9 | Lower CI `audit` to `--audit-level=moderate` (or wire Dependabot) | `ci.yml:78` | Actually gates the 2 open vulns (**M10**) |
| 10 | Rename `src/_frozen_prod` → non-`_` (e.g. `src/engine/__prod_contract_tests__`) | `package.json test:prod` | Stops it reading as "safe to delete" (see Appendix A) |

*Note: Quick Wins 5 and 6 touch code/migrations and are recommendations — this review makes **no code changes**.*

---

## 8. Future Refactors (structural; sequence deliberately, do not do all at once)

1. **Introduce a domain-module (feature-folder) layer.** Bind each workflow — intelligence brief, vendor assurance, posture — into one module so orchestration *composes* stages instead of collapsing into `cyberSignalProcessingService`/`briefScheduler`. This is the structural fix for **H2/H3/M2** and the single highest-leverage change.
2. **Unify scoring under one authority.** Route signal/risk/vendor scoring through `src/engine` (or formally designate two engines with a shared contract) so there is one scoring source of truth, not the `src/engine` vs `src/api/lib/*Engine.ts` split (**H1**). Directly serves `CLAUDE.md §10` ("shared risk engine at the center").
3. **Insert a thin service layer between routes and `pg`/Stripe/LLM.** Routes stop embedding raw SQL and SDK calls (**M2**), the 618 raw `.query()` calls consolidate into a data-access layer, and cross-org scoping becomes enforceable in **one** place instead of ~75 route files.
4. **Make the Express↔Next boundary a real typed contract.** Consolidate the 5 contract directories into one package consumed by *both* engine and app, replacing the ~160 hand-copied types in `api.ts` and collapsing the per-route proxies into a generated client or a single catch-all proxy (**M1/M3**).
5. **Retire the debt trees.** Delete the ~360 dead tracked files and stale parallel dirs (**H7**) in one reviewed sweep, and resolve the two-`signal`-tables split (**H4**) with an explicit retirement/rename plan for the un-scoped `signals` table.
6. **Rework the entitlement model** into per-tier ranks or a capability map so the five commercial tiers are enforceable at the API layer (**C1**) — a prerequisite for monetizing Team vs Platform vs Enterprise.

---

## Appendix A — Verified corrections (where reviewers disagreed or first impressions were wrong)

1. **"Committed secrets" — FALSE.** Initial visual scan flagged `issue.private.pem` / `engine-keypair.json` at root, and one reviewer asserted they were tracked. Re-verified by hand: `git ls-files` returns empty and `git log --all` shows **0 commits** for every `.pem`/keypair/`.env` file; `.gitignore` covers them. Downgraded from a false **Critical** to **M9** (local key hygiene). *This is why the review grounds every claim — the eyeball read was wrong.*
2. **`dist-*` build artifacts — NOT tracked.** `dist/`, `dist-intelligence-worker/`, etc. exist on disk but `git ls-files` = 0; `.gitignore` covers `dist/` and `dist-*/`. No action.
3. **`src/_frozen_prod` — NOT dead.** Despite the `_`-prefix, it is a **live prod-contract test corpus** wired into `package.json` `test:prod` and `vitest.config.ts`, importing the active engine. **Rename, do not delete** — it guards current engine behavior. (Its ~247 files are excluded from the "~360 deletable" count.)

## Appendix B — Reviewer coverage

Five parallel read-only reviewers: (1) architecture & boundaries, (2) security boundaries, (3) dead-code/duplication/structure, (4) dependencies/build/DX, (5) API-surface/complexity/scaling. Governing docs read for calibration: `CURRENT_STATE_ARCHITECTURE.md`, `FINAL_PRODUCT_STANDARD.md`, `CANONICAL_DOMAIN_MODEL.md` (referenced), `CLAUDE.md`. All `path:line` references reflect the tree at the reviewed branch and should be re-anchored if the code moves.

---

*End of review. No code was modified. This document is the sole deliverable.*
