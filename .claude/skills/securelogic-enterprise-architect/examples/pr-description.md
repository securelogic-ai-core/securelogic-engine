# Example: PR description

The house style is a tight, honest description that a reviewer can map to
`pr-checklist.md`. State the active package, the exact scope, the isolation/entitlement
impact, the tests you ran (with real results), ops/flag/migration notes, and the rollback
path. Don't overclaim ("production-ready", "fully done") beyond what was actually validated.

---

```markdown
## <package-name>: add Widget primitive (CRUD + posture-neutral)

### What & why
Adds the `widgets` customer-data primitive (table + 4 routes) so orgs can track <X>.
Part of the **<active-package-name>** package per BUILD_SEQUENCE.md. Pure CRUD; does not
feed posture or the brief yet (a later package wires that).

### Scope (exact)
- `db/migrations/20260815_widgets.sql` — table, org index, canonical RLS policy (inert).
- `src/api/routes/widgets.ts` — POST/GET/GET:id/PATCH:id, premium-gated.
- `src/api/lib/widgetValidation.ts` — create validator.
- `src/api/routes/index.ts` — mount under /api.
- Tests (below). CANONICAL_DOMAIN_MODEL.md row added.

### Tenant isolation & entitlements
- Every query scoped `WHERE organization_id = $n` from `req.organizationContext`.
- 404 (not 403) on cross-org id miss; no cross-row refs in this slice.
- RLS policy added (NULLIF / NOT FORCE) — inert pre-flip, consistent with the rollout.
- Gated `requireEntitlement("premium")` per TENANT_ISOLATION_STANDARD §9 (platform surface).
- Mutations audit-logged (`widget.created`, `widget.updated`).

### Tests run
- `vitest run src/api/.../__tests__/widget*.test.ts` → PASS (12 tests: validator branches,
  handler org early-return, audit fire, response shape).
- `npm run test:isolation -- widgetsRls` → PASS (org A ≠ org B; unset GUC → 0 rows;
  cross-org INSERT rejected by WITH CHECK).
- `npm run typecheck` → PASS.
(Did NOT run the full repo suite — package validation policy; the above is the minimum set.)

### Ops / env / flags
- No new env vars. No new secrets. No feature flag (pure additive CRUD, low risk).
- Migration is idempotent and auto-applies on engine boot; verified through the isolation
  setup path.
- No render.yaml change.

### Rollback
- Revert the commit. Forward-only migration documents its manual DROP in the file header.
  No data backfill, nothing destructive.

### Validated in
- Staging (develop) before any promotion to production. Not a Demo-only validation.
```

---

## Reminders
- **Do not open/commit without explicit authorization** (`CLAUDE.md` / `BUILD_SEQUENCE.md`).
  Present the exact commit scope and stop.
- Branch-sync PRs use `gh pr merge <N> --merge` (never squash) — see the branch-sync rule.
- If tests failed or a step was skipped, **say so** with the output. Faithful reporting beats
  a clean-looking but false description.
