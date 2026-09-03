-- Migration: organization_tenant_class
-- Package:   VA-S4-4C-3 — synthetic fixture classification (slot 20261074)
--
-- Owner decision 6: synthetic validation evidence must be distinguishable from
-- real customer evidence, and permanent correctness must NOT depend on
-- remembering to exclude a literal organization ID from every real-corpus query.
--
-- ── Measured first: there is nothing to reuse ──────────────────────────────
--
-- The instruction was to reuse an existing authoritative machine-readable
-- organization classification if one exists. It does not. `organizations`
-- carries 28 added columns across the migration history — entitlement, seat
-- caps, Stripe state, SSO defaults, capability flags — and not one of them says
-- what KIND of tenant this is. Nothing in `src/` or `app/src` reads any such
-- concept.
--
-- What exists instead is a NAMING CONVENTION in `organizations.name`:
-- `[SEED] ...`, `[VALIDATION-W1] ...`, `[DECOMMISSIONED] ...`. It is a human
-- convention, read by no code, and it is INCOMPLETE — the owner-designated
-- synthetic corpus org (`b1a3da2d`, "Enterprise Validation 20260810") carries no
-- prefix at all. A convention that does not cover the one org the decision names
-- cannot be the mechanism.
--
-- ── Why a column and not a boolean named is_test ───────────────────────────
--
-- `tenant_class` is a closed vocabulary rather than a boolean because the
-- question it answers ("what is this tenant FOR") is the kind that grows a third
-- answer — a demo tenant is neither a customer nor a validation fixture — and a
-- boolean cannot grow one without being renamed. Two values ship, because two
-- are supported by evidence today; adding a third is a CHECK change, not a
-- schema redesign.
--
-- ── The default, stated honestly ──────────────────────────────────────────
--
-- DEFAULT 'customer'. This is NOT the fail-closed direction for the stated
-- requirement, and pretending otherwise would be worse than saying so: a new
-- synthetic org that nobody classifies will read as real. The alternative —
-- defaulting to synthetic — makes every genuine new customer invisible to
-- product analytics until somebody notices, which is a defect that gets
-- "fixed" by flipping the default back, leaving nothing.
--
-- So the safety does not live in the default. It lives in there being exactly
-- ONE governed way to ask for the real corpus (`realCorpusOrgPredicate` in
-- `src/api/lib/tenantClass.ts`), a CI tripwire that fails when a corpus query
-- is written without it, and a validation harness that REPORTS unclassified
-- orgs rather than guessing at them.
--
-- ── The backfill, and its limits ───────────────────────────────────────────
--
-- The name-prefix convention is read exactly ONCE, here, as a one-time
-- backfill. No runtime code reads a name prefix, then or ever: runtime reads
-- the column. Plus the one organization the owner named explicitly.
--
-- Deliberately NOT backfilled: staging orgs that are obviously synthetic but
-- carry no in-tree convention and were not named by the owner — "Staging Inc",
-- "Enterprise Validation StageA", "Onboarding Validation ...",
-- "Deliverability Check 773". Guessing at those would be inventing facts about
-- tenants to satisfy a tidy migration. They are surfaced by the validation
-- harness for an owner decision instead.
--
-- Rollback: docs/release/ROLLBACK-20261074.sql
-- Additive, idempotent, re-runnable.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS tenant_class TEXT NOT NULL DEFAULT 'customer';

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_tenant_class_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_tenant_class_check
  CHECK (tenant_class IN ('customer', 'synthetic_fixture'));

-- One-time backfill from the in-tree naming convention. Read here and nowhere
-- else, ever.
UPDATE organizations
   SET tenant_class = 'synthetic_fixture'
 WHERE tenant_class = 'customer'
   AND (name LIKE '[SEED]%' OR name LIKE '[VALIDATION-%' OR name LIKE '[DECOMMISSIONED]%');

-- The organization owner decision 6 designates as retained synthetic validation
-- fixture material. Pinned by id because its name matches no convention.
UPDATE organizations
   SET tenant_class = 'synthetic_fixture'
 WHERE id = 'b1a3da2d-5045-47c6-bd02-dec206c790fe'::uuid
   AND tenant_class = 'customer';

-- Real-corpus reads filter on this, so it must not be a sequential scan of the
-- whole tenant table as the estate grows.
CREATE INDEX IF NOT EXISTS idx_organizations_tenant_class
  ON organizations (tenant_class);

COMMENT ON COLUMN organizations.tenant_class IS
  'VA-S4-4C-3. What this tenant IS, for measurement purposes. ''customer'' = '
  'real customer evidence. ''synthetic_fixture'' = controlled validation '
  'material that must NEVER enter real-corpus measurements, customer assurance '
  'metrics, product analytics or prevalence claims. Ask for the real corpus '
  'through realCorpusOrgPredicate() in src/api/lib/tenantClass.ts — never by '
  'excluding organization ids by hand, and never by reading a name prefix.';
