# Reference — Release / PR Reviewer

Deploy + CI + migration facts for release review. **VERIFIED** unless tagged.

## 1. Services (VERIFIED — `render.yaml`)
| Service | Type | Region (prod) | Branch→env |
|---|---|---|---|
| securelogic-engine | web | virginia | main→prod / develop→staging |
| securelogic-intelligence-worker | worker | virginia | " |
| securelogic-vendor-extraction-worker | worker | virginia | " (ANTHROPIC_API_KEY here) |
| securelogic-posture-worker | worker | **oregon** | " (cross-region to VA DB) |
| securelogic-data-rights-worker | worker | **oregon** | " (cross-region to VA DB) |
| securelogic-app | web | oregon | " |
| securelogic-website | web | oregon | " |

+ 6 staging mirrors (all virginia). `delivery-worker` exists in `services/` but is **not** in
render.yaml (dead).

## 2. Deploy behavior (VERIFIED)
- `main` merge → **all** connected services redeploy; engine `startCommand` = `npm run migrate
  && npm start`, so **pending migrations auto-apply on boot**. A failing migration blocks engine
  startup. No buildFilter — app-only PRs still restart+migrate the engine.
- Workers build with their own `tsc -p services/<w>/tsconfig.json` and do **not** auto-migrate.
- Feature flags = `SECURELOGIC_*_ENABLED` env vars; risky behavior ships dark, staged first.

## 3. CI (VERIFIED — `.github/workflows/ci.yml`)
Jobs on PR/push to develop+main: `typecheck` (tsconfig.ci.json, stricter:
exactOptionalPropertyTypes / noUncheckedIndexedAccess), `lint` (eslint + custom
`no-unrewriteable-stmt-in-tenant-wrap`), `test` (vitest, db-free), `build` (tsconfig.prod.json
+ **separate worker tsc**), `cross-org-isolation` (vitest.isolation.config.ts on postgres:16),
`tenant-coverage` (warn-only census of stray `new Pool()` / escape hatches). checkout +
setup-node are SHA-pinned. **UNKNOWN:** exact required-check set in `main` ruleset (the `audit`
check has flaked historically — re-verify before promoting).

## 4. Migrations (VERIFIED — `db/migrations/`, `scripts/runMigrations.ts`)
- Plain `.sql`, alphabetical (timestamp) order, tracked in `schema_migrations(filename UNIQUE)`,
  each in its own transaction. Forward-only (no down-migrations run).
- Must be **idempotent** (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`) and
  **auto-apply-safe**. Customer-data table = `organization_id NOT NULL` FK + index + canonical
  RLS policy (NULLIF / NOT FORCE). Enum = CHECK constraint. See architect skill
  `database-guidelines.md` + `examples/migration.md`.

## 5. Tests (VERIFIED)
~171 unit files (`npm test`, db-free) + ~39 isolation files (`test/isolation/`, real Postgres).
`npm run check` = guard-imports + lint + typecheck + build + test:prod. Per `BUILD_SEQUENCE.md`
validation policy: run the **minimum** the package needs; targeted over repo-wide.

## 6. Rollback patterns
- Prefer **flag-flip** revertability (a `SECURELOGIC_*_ENABLED` off) or a clean `git revert`.
- Forward-only migration → document a manual rollback (`DROP POLICY` / `DISABLE RLS` / `DROP
  TABLE`) in the file header. Never a destructive data op without authorization + an evidence
  trail (`docs/investigation/`, not `/tmp`).
- Config-not-build changes (Render dashboard env) aren't in the repo — flag them as
  operator-verifiable, **UNKNOWN** from the diff alone.

## 7. Branch hygiene (VERIFIED standing rules)
- Promote with `gh pr merge <N> --merge` (NOT squash). Verify `origin/develop..origin/main`
  empty + develop tip has two parents after.
- Branch fresh off `origin/develop`; preflight reused branches with
  `git diff --stat origin/develop...HEAD` (squash-merged-but-undeleted branches re-surface the
  whole changeset).

## 8. Customer-impact watch-list
- Entitlement-tier moves (e.g. a route flipped standard→premium) change who can call an API —
  reconcile UI redirects + direct-API-key callers.
- **Parked price labels:** `app/src/components/UpgradeCard.tsx`, app `/pricing`,
  `website/src/lib/pricing.ts` disagree by decision — don't touch without authorization.
- Breaking API response shapes (the app keys off `{ error: "snake_case" }` codes and field
  names) — additive changes preferred.

## Cross-references
Security depth → **securelogic-security-reviewer**. Is-this-the-right-package + doc-sync →
**securelogic-program-manager**. Architecture/layering → **securelogic-enterprise-architect**.
