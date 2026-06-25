# Example: migration (table + index + RLS policy)

Mirrors the real migrations in `db/migrations/`. A new **customer-data** table needs:
`organization_id NOT NULL` FK, an org-leading index, canonical enum CHECKs, and the
canonical (inert-but-required) RLS policy. The `NULLIF` guard and `NOT FORCE` are
load-bearing — copy them exactly. Reference: `20260619_findings_rls_pilot.sql`,
`20260620_batch_a1_rls_policies.sql`.

File: `db/migrations/20260815_widgets.sql` (use today's date; order after dependencies).

```sql
-- Migration: widgets
-- Package:   <active-package-name>
--
-- Creates the customer-data table `widgets` with tenant scoping, an org-leading
-- index, canonical status CHECK, and the inert-pre-flip RLS policy (A04-G1
-- template §A). Safe to auto-apply on engine boot; idempotent.
--
-- Manual rollback (forward-only migrations; only if ever needed):
--   DROP POLICY IF EXISTS widgets_tenant_isolation ON widgets;
--   ALTER TABLE widgets DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS widgets;

CREATE TABLE IF NOT EXISTS widgets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ
);

-- Org-leading indexes for the hot read paths.
CREATE INDEX IF NOT EXISTS idx_widgets_org        ON widgets(organization_id);
CREATE INDEX IF NOT EXISTS idx_widgets_org_status ON widgets(organization_id, status);
-- Supports keyset pagination ORDER BY created_at DESC, id DESC:
CREATE INDEX IF NOT EXISTS idx_widgets_org_created
  ON widgets(organization_id, created_at DESC, id DESC);

-- ----------------------------------------------------------------------------
-- RLS: INERT until the owner→app_request flip (NOT FORCE), but ship it now so
-- the eventual flip is clean. NULLIF(...,'') makes an unset OR reset-to-empty
-- GUC resolve to NULL → zero rows (fail-closed), never a 22P02 cast error.
-- ----------------------------------------------------------------------------
ALTER TABLE widgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS widgets_tenant_isolation ON widgets;

CREATE POLICY widgets_tenant_isolation ON widgets
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
```

## Adding a non-null org column to an EXISTING table

Add nullable → backfill → set not null, all idempotent:

```sql
ALTER TABLE legacy_things ADD COLUMN IF NOT EXISTS organization_id UUID;
UPDATE legacy_things lt
   SET organization_id = p.organization_id
  FROM parents p
 WHERE lt.parent_id = p.id
   AND lt.organization_id IS NULL;
ALTER TABLE legacy_things ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE legacy_things
  ADD CONSTRAINT legacy_things_org_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
```

## Junction table with soft delete

```sql
CREATE TABLE IF NOT EXISTS widget_tag_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  widget_id       UUID NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
  tag             TEXT NOT NULL,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One live link per (widget, tag); re-create allowed after soft delete.
CREATE UNIQUE INDEX IF NOT EXISTS uq_widget_tag_live
  ON widget_tag_links(widget_id, tag) WHERE deleted_at IS NULL;
```

## Pair it with an isolation test
Add `test/isolation/widgetsRls.test.ts` modeled on `findingsRls.test.ts`: `SET ROLE
app_request`, set the GUC to org A, prove A sees only A's rows; unset the GUC → zero rows;
attempt a cross-org INSERT → rejected by `WITH CHECK`.

## Checklist (from `database-guidelines.md` §8)
idempotent · auto-apply-safe · `organization_id NOT NULL` FK + org-leading index · canonical
RLS (`NULLIF`, `NOT FORCE`) · canonical enum CHECKs · soft-delete only on junctions ·
intentional FK `ON DELETE` · header comment + manual rollback · paired isolation test ·
`CANONICAL_DOMAIN_MODEL.md` updated if a new canonical object.
