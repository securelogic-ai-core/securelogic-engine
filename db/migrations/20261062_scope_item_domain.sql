-- Migration: scope_item_domain
-- Package:   VA-Q2 P2 — domain first-class on scope items (slot 20261062)
--
-- Every scope item records the assessment DOMAIN it was asked under, so the
-- reviewer surface and the engagement read can group the questionnaire by
-- Security / Privacy / AI / Resilience / Nth party / Compliance.
--
-- ── One vocabulary ──────────────────────────────────────────────────────────
--
-- The CHECK below is the SAME closed set as `questions.domain` (20261059) and
-- `ASSESSMENT_DOMAINS` in src/api/lib/vendorRisk/requirementDomain.ts. The
-- resolver computes it (S5, scope-rule corpus 1.1.0) — it is never authored
-- at the route and never derived from `findings.domain`, which is a different
-- vocabulary (D2 ruling, 2026-08-28: scope items only; findings untouched).
--
-- ── NULL on every pre-Q2 row; NO backfill ───────────────────────────────────
--
-- An engagement stamped `scope_rule_version = '1.0.0'` re-resolves under the
-- 1.0.0 corpus, which has no domain rule. Backfilling a domain nobody computed
-- at the time would be a fabricated history (the Q1 P3 amendment principle),
-- so historical rows stay NULL and the reads report `domains: null` for them.
--
-- ── Additive, idempotent, no policy change ──────────────────────────────────
--
-- Nullable column + CHECK + one partial index. The column inherits the table's
-- existing RLS policy (`vendor_engagement_scope_items_tenant_isolation`,
-- 20260924) and the existing `app_request` grant, which is table-level — no
-- new policy, no new grant. Frozen snapshots stay frozen: nothing here touches
-- the `issued`-onward write guard (isScopeMutable) or the question_set_hash.
--
-- Rollback: docs/release/ROLLBACK-20261062.sql (drop index, drop column).

ALTER TABLE vendor_engagement_scope_items
  ADD COLUMN IF NOT EXISTS domain TEXT NULL;

ALTER TABLE vendor_engagement_scope_items
  DROP CONSTRAINT IF EXISTS vendor_engagement_scope_items_domain_check;
ALTER TABLE vendor_engagement_scope_items
  ADD CONSTRAINT vendor_engagement_scope_items_domain_check CHECK (
    domain IS NULL
    OR domain IN ('security', 'privacy', 'ai', 'resilience', 'nth_party', 'compliance')
  );

-- Group-by-domain on one engagement; pre-Q2 rows (NULL) are not indexed.
CREATE INDEX IF NOT EXISTS idx_vendor_engagement_scope_items_domain
  ON vendor_engagement_scope_items (engagement_id, domain)
  WHERE domain IS NOT NULL;

COMMENT ON COLUMN vendor_engagement_scope_items.domain IS
  'The assessment domain this item was asked under (VA-Q2 P2). Computed by the '
  'scope resolver for engagements stamped scope_rule_version >= 1.1.0; NULL on '
  'every item resolved under 1.0.0 and never backfilled. Same closed vocabulary '
  'as questions.domain. `compliance` iff the item was reached through an active '
  'obligation (S3).';
