-- 20261092_vendor_engagement_relationship_reseeds.sql
--
-- WA-3 / R8-2 (owner ruling 2026-09-05) — the provenance envelope for a
-- pre-issue reseed of an engagement's relationship-derived basis.
--
-- ── The ruling this serves ─────────────────────────────────────────────────
-- R8: a relationship re-intake must NEVER silently mutate the determination or
-- composition basis of an already-issued engagement. For a DRAFT engagement it
-- MAY be explicitly recomposed against the new intake, "preserving provenance
-- of prior basis, new basis, reason, actor/time, result".
--
-- That last clause had nowhere to live. `vendor_relationship_intake.change_reason`
-- (WA-2, 20261090) explains why the FACTS changed on the relationship; it says
-- nothing about an analyst deciding to carry those facts onto a particular
-- engagement. This table is that decision, and only that decision.
--
-- ── Why the prior and new basis are stored BY VALUE ────────────────────────
-- The whole point is to answer "what was this engagement assessing against
-- before, and what is it assessing against now". Pointers would not survive:
-- the relationship's classification is recomputed on every intake, so a
-- reference to it would show today's answer for both halves of the question.
-- Seventeen closed-vocabulary values on each side, plus the field names that
-- differed, is small and durable.
--
-- ── What this table is NOT ─────────────────────────────────────────────────
--   * not a scope record — the reseed rewrites the engagement's copied basis
--     and NOTHING else. Scope items, responses, evidence, findings and
--     remediation are untouched, and the analyst must still run the ordinary
--     composition step to see and accept a new scope.
--   * not a status object — there is no `applied` / `reverted` column. A row
--     here is a thing that happened.
--   * not reachable post-issue. The route refuses outside the scope-mutable
--     states, so no row can describe a rewrite of issued history.
--
-- Append-only through the SHARED worm_guard_mutation (20261017/20261018) — never
-- a private copy, because the single sanctioned certified-erasure exception
-- lives in that one function and wormGuardConsolidation.test.ts fails the build
-- on any table that brings its own. `app_request` gets SELECT + INSERT only, so
-- an UPDATE or DELETE from the application path is refused as
-- permission-denied before the trigger even runs — two independent walls.
--
-- Additive, empty at birth, nothing backfilled: there is no honest prior basis
-- to invent for a reseed that happened before the record existed.
--
-- Rollback: docs/release/ROLLBACK-20261092.sql

CREATE TABLE IF NOT EXISTS vendor_engagement_relationship_reseeds (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  engagement_id         UUID         NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,

  -- RESTRICT: deleting a relationship must not erase the record that an
  -- engagement was rebased onto it.
  relationship_id       UUID         NOT NULL REFERENCES vendor_relationships(id) ON DELETE RESTRICT,

  -- The seventeen-value determination basis on each side, by value.
  -- relationshipBasis.ts owns the field list; the database checks only shape.
  prior_basis           JSONB        NOT NULL
                          CONSTRAINT vendor_engagement_relationship_reseeds_prior_shape
                          CHECK (jsonb_typeof(prior_basis) = 'object'),
  new_basis             JSONB        NOT NULL
                          CONSTRAINT vendor_engagement_relationship_reseeds_new_shape
                          CHECK (jsonb_typeof(new_basis) = 'object'),

  -- Which of the seventeen actually moved. Never empty: a reseed that changed
  -- nothing is refused at the route, so a no-op can never be recorded as an
  -- event.
  changed_fields        TEXT[]       NOT NULL
                          CONSTRAINT vendor_engagement_relationship_reseeds_changed_nonempty
                          CHECK (array_length(changed_fields, 1) >= 1),

  -- The analyst's reason. Same bar as the inherent-risk override and the WA-2
  -- applicability challenge: a governance act carries its reason or it does not
  -- happen.
  reason                TEXT         NOT NULL
                          CONSTRAINT vendor_engagement_relationship_reseeds_reason_length
                          CHECK (length(trim(reason)) BETWEEN 10 AND 4000),

  -- NOT NULL + RESTRICT, the 20261071 posture applied at birth. SET NULL would
  -- turn a governance act into an anonymous one; user erasure tombstones rather
  -- than deletes, so RESTRICT never fires under O-3.
  reseeded_by_user_id   UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_engagement_relationship_reseeds_engagement
  ON vendor_engagement_relationship_reseeds (organization_id, engagement_id, created_at DESC);

COMMENT ON TABLE vendor_engagement_relationship_reseeds IS
  'WA-3 R8: an analyst explicitly rebased a PRE-ISSUE engagement onto its '
  'relationship''s current determination. Prior basis, new basis, which of the '
  'seventeen fields moved, why, who and when — by value, append-only. Records '
  'the decision only: the reseed rewrites the engagement''s copied basis and '
  'never its scope, responses, evidence, findings or lifecycle state.';

-- Integrity: the engagement and the relationship must both belong to the
-- writing tenant, and the relationship must be the one the engagement is
-- actually bound to. Verified here as well as at the route, because a
-- provenance row that can point at another tenant's relationship is not an
-- audit trail.
CREATE OR REPLACE FUNCTION vendor_engagement_relationship_reseeds_check_refs()
RETURNS TRIGGER AS $$
DECLARE
  ok BOOLEAN;
BEGIN
  SELECT TRUE INTO ok
    FROM vendor_engagements e
   WHERE e.id = NEW.engagement_id
     AND e.organization_id = NEW.organization_id
     AND e.relationship_id = NEW.relationship_id
   LIMIT 1;
  IF ok IS NULL THEN
    RAISE EXCEPTION 'engagement does not exist in this organization, or is not bound to this relationship'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  ok := NULL;
  SELECT TRUE INTO ok
    FROM vendor_relationships r
   WHERE r.id = NEW.relationship_id
     AND r.organization_id = NEW.organization_id
   LIMIT 1;
  IF ok IS NULL THEN
    RAISE EXCEPTION 'relationship does not exist in this organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vendor_engagement_relationship_reseeds_check_refs
  ON vendor_engagement_relationship_reseeds;
CREATE TRIGGER vendor_engagement_relationship_reseeds_check_refs
  BEFORE INSERT OR UPDATE OF engagement_id, organization_id, relationship_id
  ON vendor_engagement_relationship_reseeds
  FOR EACH ROW EXECUTE FUNCTION vendor_engagement_relationship_reseeds_check_refs();

-- ── Append-only, via the ONE shared guard ──────────────────────────────────
DROP TRIGGER IF EXISTS trg_vendor_engagement_relationship_reseeds_worm
  ON vendor_engagement_relationship_reseeds;
CREATE TRIGGER trg_vendor_engagement_relationship_reseeds_worm
  BEFORE UPDATE OR DELETE ON vendor_engagement_relationship_reseeds
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation(
    'append-only (WA-3 R8)', 'is not permitted', ' — record a new reseed instead');

DROP TRIGGER IF EXISTS trg_vendor_engagement_relationship_reseeds_no_truncate
  ON vendor_engagement_relationship_reseeds;
CREATE TRIGGER trg_vendor_engagement_relationship_reseeds_no_truncate
  BEFORE TRUNCATE ON vendor_engagement_relationship_reseeds
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation(
    'append-only (WA-3 R8)', 'is not permitted', ' — record a new reseed instead');

-- ── Tenant isolation ───────────────────────────────────────────────────────
ALTER TABLE vendor_engagement_relationship_reseeds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_engagement_relationship_reseeds_tenant_isolation
  ON vendor_engagement_relationship_reseeds;
CREATE POLICY vendor_engagement_relationship_reseeds_tenant_isolation
  ON vendor_engagement_relationship_reseeds
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Least privilege: no UPDATE, no DELETE for the application path.
GRANT SELECT, INSERT ON vendor_engagement_relationship_reseeds TO app_request;
