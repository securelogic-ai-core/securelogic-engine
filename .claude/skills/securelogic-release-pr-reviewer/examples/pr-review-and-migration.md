# Example: reviewing a PR with a migration

A worked review showing the release-specific catches (the security/architecture catches live
in those skills). Assume the PR adds a `widgets` table + routes.

## Step 1 — Read the diff against the deploy reality
- This adds `db/migrations/20260815_widgets.sql`. **A `main` merge will auto-apply it on engine
  boot.** First question: is it idempotent and safe? If it `CREATE TABLE` without `IF NOT
  EXISTS`, or `CREATE POLICY` without `DROP POLICY IF EXISTS`, a re-run errors and **blocks the
  engine from starting** → BLOCKING.
- It touches `src/api/routes/index.ts` (mount) — app + engine both redeploy. No buildFilter.

## Step 2 — Migration review (BLOCKING checks)
```diff
- CREATE TABLE widgets (
+ CREATE TABLE IF NOT EXISTS widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
-   organization_id UUID,
+   organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    ...
  );
+ CREATE INDEX IF NOT EXISTS idx_widgets_org ON widgets(organization_id);
+ ALTER TABLE widgets ENABLE ROW LEVEL SECURITY;
+ DROP POLICY IF EXISTS widgets_tenant_isolation ON widgets;
+ CREATE POLICY widgets_tenant_isolation ON widgets
+   USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
+   WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
```
Findings: missing `IF NOT EXISTS` (re-apply hazard) and a nullable `organization_id` with no FK
or index or RLS — all **BLOCKING** for a customer-data table. Header lacks a manual-rollback
comment.

## Step 3 — Tests
- Unit tests for the handlers/validator? (mocked pg)
- **`test/isolation/widgetsIsolation.test.ts` proving org A ≠ org B?** If absent → **BLOCKING**
  (customer-data surface with no negative-path proof).
- Migration applies through `test/isolation/setup.ts`?

## Step 4 — Deployment / env / rollback
- Any new env var? If yes: in `render.yaml` prod+staging + `.env.example` + `validateEnv` if
  boot-required, on the correct service.
- Is the new behavior flag-gated, enabled in staging first? Pure-additive CRUD may not need a
  flag — judge blast radius.
- Rollback: clean `git revert`? Migration header documents the manual `DROP`?

## Step 5 — Customer impact
- Entitlement tier on the new routes — does it change who can call existing endpoints? (Here,
  new endpoints only — low impact.)
- No price/label files touched (parked).
- Response shapes additive (the app keys off `{ error: "..." }` codes).

## Step 6 — Verdict (honest)
```
REQUEST CHANGES (3 blocking):
1. Migration not idempotent / not auto-apply-safe — add IF NOT EXISTS + DROP POLICY guard,
   else a re-run blocks engine boot. (db/migrations/20260815_widgets.sql)
2. organization_id must be NOT NULL + FK + index + RLS policy — customer-data table.
3. No cross-org isolation test — add test/isolation/widgetsIsolation.test.ts.
Non-blocking:
- Migration header missing a manual-rollback comment.
- Consider a composite (organization_id, status) index for the list filter.
Deploy note: confirm CI cross-org-isolation is green; this lands on develop (staging) first —
do NOT promote to main until the isolation test exists and passes.
```

## Promotion check (when moving develop → main later)
```bash
gh pr merge <N> --merge        # never squash
git fetch origin
git log --oneline origin/develop..origin/main   # expect EMPTY after a --merge promote
# develop tip should have two parents (merge commit)
```
