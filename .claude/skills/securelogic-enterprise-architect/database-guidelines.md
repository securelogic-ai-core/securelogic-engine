# Database Guidelines

The data layer is **raw `pg` (node-postgres) with hand-written SQL — no ORM**. ~76
tables, ~125 migrations in `db/migrations/`. This is deliberate. Follow the conventions
below; they are derived from the existing migrations and `TENANT_ISOLATION_STANDARD.md`.

---

## 1. Migration system

- Migrations are **plain `.sql` files** in `db/migrations/`, applied by
  `scripts/runMigrations.ts` in **alphabetical (== timestamp) order**, tracked in
  `schema_migrations(filename UNIQUE)`. Each runs in its **own transaction** (rollback on
  error). Already-applied files are skipped.
- The engine runs `npm run migrate` on boot (Render `startCommand`), so a merge to `main`
  deploys and migrates automatically. Migrations therefore must be **safe to auto-apply**
  and **idempotent**.
- **Naming:** `YYYYMMDD_short_snake_case_description.sql` (e.g.
  `20260705_evidence_rls.sql`, `20260621_gdpr_foundations.sql`). Use today's date; if
  another migration shares the date, the description orders them — keep dependent
  migrations correctly ordered.
- **Forward-only.** No down-migrations are run. If a rollback is ever needed it's a manual
  procedure — document it in a comment block at the top of the migration (the RLS pilot
  is a good model: it documents the manual `DROP POLICY` / `DISABLE` rollback).

### Idempotency patterns to use
- `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`.
- `ENABLE ROW LEVEL SECURITY` is idempotent; `CREATE POLICY` is **not** — guard it with
  `DROP POLICY IF EXISTS … ;` first.
- Backfill + `SET NOT NULL` in the same migration when adding a non-null org column to an
  existing table (add nullable → backfill → set not null).

---

## 2. Tenant scoping at the schema level (mandatory)

Every **customer-data** table MUST have:

```sql
organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
```

plus an index leading with `organization_id` for hot paths:

```sql
CREATE INDEX IF NOT EXISTS idx_<table>_org ON <table>(organization_id);
-- or composite for filtered reads:
CREATE INDEX IF NOT EXISTS idx_<table>_org_status ON <table>(organization_id, status);
```

**Intentionally NOT org-scoped** (`TENANT_ISOLATION_STANDARD.md` §1): shared/global signal
tables (`signals`, `cyber_signals`, KEV/CVE caches), platform-internal tables
(`schema_migrations`, `jobs` is org-stamped but system-managed, `email_suppressions`,
`feed_health`), and `organizations` itself. Anything holding customer-derived content
**must** be org-scoped.

**Child/junction tables without a direct `organization_id`** (rare here — most carry it
explicitly) must enforce tenancy through the parent FK and an `EXISTS`-parent RLS policy.
Prefer adding `organization_id` directly; it's the established choice.

---

## 3. Row-Level Security (RLS) — required on new tables, but inert today

~20 tables already have RLS policies. The rollout (A04-G1) is toward an
`owner → app_request` role flip; until then policies are **INERT** (the app connects as
owner, `NOT FORCE`). **RLS is not your live isolation guarantee — the `WHERE
organization_id` discipline is.** Still, ship a policy on every new customer-data table so
the eventual flip is clean.

The canonical policy (copy exactly — the `NULLIF` guard is load-bearing):

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS <table>_tenant_isolation ON <table>;

CREATE POLICY <table>_tenant_isolation ON <table>
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
```

Why each piece:
- `current_setting('app.current_org_id', true)` — `true` = don't error if unset.
- `NULLIF(…, '')` — a **pooled** connection that had the GUC set then reset reads back as
  `''`, and `''::uuid` raises `22P02`. `NULLIF` collapses both unset and reset-to-empty to
  `NULL` → `organization_id = NULL` → **zero rows**. Fail-closed, never a 500.
- **`NOT FORCE`** — deliberately omitted. The owner/elevated channel (`pgElevated`,
  migrations, cross-org workers via `MIGRATION_DATABASE_URL`) must keep bypassing RLS for
  legitimate cross-org work. `FORCE` would break that.
- One `FOR ALL` policy (USING + WITH CHECK), not four per-command policies.

Always pair a new RLS migration with an isolation test under `test/isolation/` that
connects as `app_request` via `SET ROLE` and proves the policy (see `testing-guidelines.md`).

---

## 4. Query patterns (from `TENANT_ISOLATION_STANDARD.md` §4)

```sql
-- SELECT
SELECT … FROM <table> WHERE organization_id = $1 AND …;

-- INSERT (organization_id from req.organizationContext, NEVER from the body)
INSERT INTO <table> (organization_id, …) VALUES ($1, …);

-- UPDATE / DELETE by id — org predicate is MANDATORY even with a UUID id
UPDATE <table> SET … WHERE id = $1 AND organization_id = $2;
DELETE FROM <table>     WHERE id = $1 AND organization_id = $2;

-- Cross-row reference — pre-flight same-org check before persisting
SELECT 1 FROM <referenced_table> WHERE id = $refId AND organization_id = $orgId;
```

**Forbidden:** `WHERE id = $1` without an org clause on customer data; `INSERT` taking
`organization_id` from the request body; a `JOIN` that drops org scoping at any join;
`req.body.organization_id`.

---

## 5. Schema conventions (observed in migrations)

- **Primary keys:** `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- **Timestamps:** `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ`
  (set to `now()` on UPDATE in the route).
- **Enums as CHECK constraints**, not native Postgres enums:
  `status TEXT NOT NULL CHECK (status IN ('open','in_progress','closed'))`. This keeps
  enum evolution a plain migration. Use the **canonical** enum values
  (`CANONICAL_DOMAIN_MODEL.md`) and respect the PascalCase-Severity vs lowercase-criticality
  split.
- **Polymorphic links:** `(source_type, source_id)` / `(target_type, target_id)` pairs
  (findings, evidence, signal_match_suggestions) — keep this shape consistent.
- **Soft deletes** apply to **junction/link tables** (`deleted_at TIMESTAMPTZ` + a
  **partial unique** index `… WHERE deleted_at IS NULL`). Main entity tables use **hard
  delete** via `ON DELETE CASCADE`. Don't add `deleted_at` to a main entity without a
  reason.
- **GDPR tombstone:** `users`/`organizations` are *not* hard-deleted on erasure — PII is
  scrubbed in place and the UUID is preserved for audit integrity
  (`20260621_gdpr_foundations.sql`).
- **Foreign keys** are explicit with `ON DELETE` behavior chosen deliberately (CASCADE for
  ownership, RESTRICT/SET NULL only with intent).

---

## 6. Indexing

- Lead with `organization_id` on every customer-data index — it's in every WHERE clause.
- Add composite indexes for known filter/sort paths (e.g.
  `(organization_id, status)`, `(organization_id, priority)`, `(organization_id, criticality)`).
- For cursor pagination (`(created_at, id) < (…, …)`), an index on
  `(organization_id, created_at DESC, id DESC)` supports the keyset scan.
- Partial unique indexes back the "re-suggest after dismissal" and "one live link" patterns.

---

## 7. Connections — use the right handle

From `src/api/infra/postgres.ts` (see `architecture.md` §7):

| Handle | Use for |
|---|---|
| `pg` | **Default.** Org-scoped route/lib queries. Tenant-aware inside `withTenant`. |
| `pgElevated` | Legitimately cross-org work: audit writes, worker org-enumeration, signup org-insert, admin reads. |
| `pgRaw` | Escape hatch only: `ISOLATION LEVEL`, advisory locks, `LISTEN/NOTIFY`, `COPY`. Set your own GUC. |
| `withTenant(orgId, fn)` | Open an explicit tenant transaction (multi-statement atomic work, workers). |

Never construct a `new Pool()` outside `postgres.ts` — the tenant-coverage census flags
it, and it bypasses the tenant plumbing.

The eslint rule `no-unrewriteable-stmt-in-tenant-wrap` forbids `BEGIN/COMMIT/ROLLBACK/SET
TRANSACTION/advisory-lock/LISTEN/NOTIFY/COPY` as static SQL inside an `asTenant` handler —
use `pgRaw` (with the documented escape) for those.

---

## 8. Migration review checklist

- [ ] Filename is `YYYYMMDD_snake_case.sql`, ordered after its dependencies.
- [ ] Safe to **auto-apply on boot** and **idempotent** (IF NOT EXISTS / DROP-then-CREATE).
- [ ] Customer-data table has `organization_id UUID NOT NULL REFERENCES organizations(id)`
      + an `organization_id`-leading index.
- [ ] RLS policy added (canonical `NULLIF` template, `NOT FORCE`) for customer-data tables.
- [ ] Enums use canonical values via CHECK constraints.
- [ ] Soft-delete only on junctions; hard-delete CASCADE on entities — chosen deliberately.
- [ ] FKs have intentional `ON DELETE` behavior.
- [ ] A top-of-file comment explains the migration and any manual rollback.
- [ ] Paired isolation test added if the table is customer-data (`test/isolation/`).
- [ ] `CANONICAL_DOMAIN_MODEL.md` updated if a new canonical object/enum is introduced.
