# Testing Guidelines

Testing is `vitest`. There are two distinct lanes — a fast database-free unit lane and a
Postgres-backed cross-org isolation lane — plus a frozen-prod regression snapshot. Match
the lane to what you're proving.

`FINAL_PRODUCT_STANDARD.md` §Testing is the bar: targeted validation is required; test the
real output shape (not just helpers); and **negative-path tests where trust matters**
(tenant isolation, access control, workflow boundaries).

---

## 1. The test lanes

| Lane | Command | Config | What it is |
|---|---|---|---|
| **Unit** | `vitest run` / `npm test` | `vitest.config.ts` | ~171 files. **Database-free.** Pure logic, validators, scoring, route handlers with mocked `pg`, pipeline helpers, output shapes. Runs in CI on every PR. |
| **Cross-org isolation** | `npm run test:isolation` | `vitest.isolation.config.ts` | ~39 files in `test/isolation/`. **Real Postgres.** Drives the app/SQL against a throwaway DB, asserts org A can't see org B and that RLS policies hold under `SET ROLE app_request`. Runs in the CI `cross-org-isolation` job with a `postgres:16` service. |
| **Frozen-prod** | `npm run test:prod` | (vitest) | `src/_frozen_prod/__tests__` — a regression snapshot of legacy behavior. You normally don't add here. |

`npm run check` runs guard-imports + lint + typecheck + build + `test:prod`. CI runs
typecheck, lint, `test`, build (incl. a separate worker `tsc`), and the isolation lane,
plus a warn-only `tenant-coverage` census (`scripts/check-tenant-coverage.sh`).

---

## 2. Where tests live

- Unit tests: co-located under `__tests__/` (or `tests/`) next to the code —
  `src/api/routes/__tests__/*.test.ts`, `src/api/lib/__tests__/*.test.ts`,
  `src/engine/**/__tests__/*.test.ts`, `services/**/__tests__/*.test.ts`,
  `packages/**/__tests__/*.test.ts`.
- Isolation tests: **only** in `test/isolation/*.test.ts`, with shared scaffolding
  (`setup.ts` applies the full migration set to a throwaway DB; `testDb.ts`, `routeManifest.ts`).
  Parallelism is disabled there (single shared seeded state).

---

## 3. Unit tests — what to cover

- **Validators** (`*Validation.ts`): every reject branch returns `{ error }`, every accept
  returns `{ input }`; length caps, enum membership, UUID/date format, null handling.
- **Scoring engine** (`src/engine/**`): pure functions — assert exact scores, the context
  multipliers, domain blending, and the **NULL-on-zero-findings** rule. These are
  deterministic; pin expected numbers.
- **Route handlers** with a mocked `pg`: assert the org early-return (403
  `organization_context_missing`), the SQL is parameterized with the org id, the audit
  event fires, the success/erro response shape, and validation 400s. (The unit lane mocks
  `pg`; it does **not** prove cross-org isolation — that's the isolation lane.)
- **Output shapes** for intelligence/summary surfaces: assert the actual projected object
  (brief item fields, summary counts), not just an internal helper —
  `FINAL_PRODUCT_STANDARD.md` §"Output-shape tests".
- **Pipeline helpers**: feed mappers, dedup hashing, normalizer, matcher scoring.

## 4. Cross-org isolation tests — the trust lane

This is the lane that protects every customer. Add to it whenever you touch customer data.

- **`crossOrgIsolation.test.ts`** seeds two orgs and probes routes proving org A's
  credentials never read/modify org B's rows (404, never another org's data).
- **`<table>Rls.test.ts`** connects as `app_request` via `SET ROLE` (no password needed)
  and asserts the policy: scoped reads see only the org's rows; an unset/empty GUC yields
  **zero rows** (the `NULLIF` fail-closed behavior); cross-org INSERT/UPDATE is rejected by
  `WITH CHECK`. Every new RLS migration needs one (model it on `findingsRls.test.ts`).
- **`<route>TenantWrap.test.ts`** / `asTenant.test.ts` / `deferredResponse.test.ts` pin the
  wrap mechanism: GUC is set, ambient `pg.query` routes to the scoped client, a throwing
  handler rolls back + releases + calls `next(err)`, no-org context runs unwrapped, and the
  response flushes only after COMMIT.
- **Worker tests** (`dataRightsWorker.test.ts`, `vendorExtractionWorker.test.ts`) prove the
  claim/reclaim/backoff/dead-letter semantics and that org-A jobs never read org-B rows
  (and the payload-email-poison case for self-export).

## 5. Negative-path expectations (per `FINAL_PRODUCT_STANDARD.md`)

For anything trust-sensitive, a happy-path test is not enough. Prove the boundary:
- cross-org read/write is rejected,
- a `viewer` cannot mutate,
- an under-entitled org gets `403 insufficient_entitlement`,
- an unset tenant GUC yields zero rows (RLS lane),
- a missing/invalid token is rejected (fail-closed),
- webhook reprocessing is idempotent.

## 6. What "validated" means for a package

`BUILD_SEQUENCE.md` validation policy: **run the minimum checks the active package
requires**, prefer targeted tests over repo-wide runs, typecheck only when needed, build
the app only when app behavior changed materially. Concretely:
- Touched a route/table with customer data → unit tests for the handler/validator **and** an
  isolation/RLS test.
- Touched the engine → unit tests with pinned numbers.
- Touched the pipeline → mapper/normalizer/output-shape unit tests; if it changes per-org
  fan-out, an isolation test.
- Touched a worker → the worker-core claim/retry tests.
- Schema change → migration applies cleanly in the isolation `setup.ts` path.

## 7. Conventions

- `describe`/`it` from `vitest`; mock with `vi`. Tests may use `any` freely (eslint relaxes
  `no-explicit-any` under `__tests__`).
- Keep unit tests **database-free** — if it needs a real DB, it belongs in `test/isolation/`.
- Deterministic: no real clock/network/LLM in unit tests; inject or mock.
- Name isolation files `<thing>Rls.test.ts` / `<thing>TenantWrap.test.ts` to match the
  existing harness.

## 8. Architectural / guardrail tests that already exist (don't break them)

- The **tenant-coverage census** greps for stray `new Pool()` and escape-hatch usage
  (warn-only today, escalates later) — route DB access through `postgres.ts`.
- The **eslint rule** `no-unrewriteable-stmt-in-tenant-wrap` is effectively an
  architectural test on `asTenant` handlers.
- The **worker build** is compiled separately in CI so a worker-only type error fails the
  PR even though workers aren't in `tsconfig.prod.json`.
Keep these green; they encode invariants this Skill describes.
