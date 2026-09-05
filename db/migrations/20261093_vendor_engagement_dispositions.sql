-- 20261093_vendor_engagement_dispositions.sql
--
-- WA-4 (owner ruling 5, 2026-09-05) — the HUMAN half of triage.
--
-- ── The shape ruling 5 set ─────────────────────────────────────────────────
-- DERIVE the machine signal; PERSIST the human disposition; keep them separate.
-- So there is no `needs_attention` column in this migration, and there must
-- never be one. "Needs attention" is a pure function of canonical assessment
-- truth (`attentionSignals.ts`), recomputed on every read. A stored triage
-- boolean is a second copy of the truth that drifts from the first, and the
-- first is the one the methodology defends.
--
-- What IS stored is what a named human decided about that state.
--
-- ── Append-only, so a decision is never silently overwritten ────────────────
-- The owner's instruction is explicit: if a disposition is mutable, preserve
-- meaningful history rather than overwrite consequential analyst decisions.
-- The strongest form of that is not an UPDATE plus a history table — it is no
-- UPDATE at all. Changing your mind writes a new row; the current disposition
-- is the latest row; every prior decision remains readable with its own actor,
-- time and reason.
--
-- Guarded by the SHARED worm_guard_mutation (20261017/20261018), never a
-- private copy — wormGuardConsolidation.test.ts fails the build on any table
-- that brings its own, because the single sanctioned certified-erasure
-- exception lives in that one function. `app_request` holds SELECT + INSERT
-- only, so an UPDATE or DELETE from the application path is refused as
-- permission-denied before the trigger even runs. Two independent walls.
--
-- ── It is a RECORD, not a MECHANISM ────────────────────────────────────────
-- Nothing reads this table to decide anything. In particular `finding_proposed`
-- and `finding_confirmed` record a human's decision ABOUT a finding and do NOT
-- create one: the governed path to a Finding remains the explicit, analyst-
-- invoked POST /api/vendor-engagements/:id/promote-findings. Same discipline as
-- WA-2's applicability challenges. No response, evidence row, scope item,
-- score or lifecycle state is written by anything in this package.
--
-- ── attention_digest ───────────────────────────────────────────────────────
-- The derived state the decision was made against, by value, in the readable
-- `reason:count|reason:count` form `digestOf()` produces. A disposition
-- recorded when three controls failed does not speak for an assessment that now
-- has five — but rather than silently invalidating a real human decision, the
-- surface compares digests and says the state moved. Stored by value and not as
-- a pointer for the same reason WA-3's reseed stores its basis by value: the
-- assessment keeps moving, and a pointer would show today's answer for both
-- halves of the question.
--
-- Additive, empty at birth, nothing backfilled — there is no honest prior
-- disposition to invent for a review that happened before the record existed.
--
-- Rollback: docs/release/ROLLBACK-20261093.sql

CREATE TABLE IF NOT EXISTS vendor_engagement_dispositions (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  engagement_id      UUID         NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,

  disposition        TEXT         NOT NULL
                       CONSTRAINT vendor_engagement_dispositions_vocabulary
                       CHECK (disposition IN
                         ('reviewed', 'accepted', 'escalated',
                          'finding_proposed', 'finding_confirmed')),

  -- Required for every disposition that asserts a judgement rather than merely
  -- acknowledging one. The same bar as overrideInherent, the WA-2 challenge and
  -- the WA-3 reseed: a governance act carries its reason or it does not happen.
  -- `reviewed` is the one acknowledgement, so it may stand alone.
  rationale          TEXT         NULL
                       CONSTRAINT vendor_engagement_dispositions_rationale_length
                       CHECK (rationale IS NULL
                              OR length(trim(rationale)) BETWEEN 10 AND 4000),
  CONSTRAINT vendor_engagement_dispositions_rationale_required
    CHECK (disposition = 'reviewed'
           OR (rationale IS NOT NULL AND length(trim(rationale)) >= 10)),

  -- The derived attention state at the moment of the decision, by value.
  -- 'none' when nothing needed attention — never NULL, so a stored digest is
  -- never mistaken for a missing one.
  attention_digest   TEXT         NOT NULL
                       CONSTRAINT vendor_engagement_dispositions_digest_nonempty
                       CHECK (length(trim(attention_digest)) BETWEEN 1 AND 2000),

  -- NOT NULL + RESTRICT, the 20261071 / 20261092 posture applied at birth.
  -- SET NULL would turn a governance act into an anonymous one; user erasure
  -- tombstones rather than deletes, so RESTRICT never fires under O-3.
  disposed_by_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The read is always "the latest disposition for this engagement", and the list
-- surface asks it for a page of engagements at once.
CREATE INDEX IF NOT EXISTS idx_vendor_engagement_dispositions_engagement
  ON vendor_engagement_dispositions (organization_id, engagement_id, created_at DESC);

COMMENT ON TABLE vendor_engagement_dispositions IS
  'WA-4 ruling 5: the HUMAN disposition of an engagement that needs attention — '
  'reviewed / accepted / escalated / finding proposed / finding confirmed, with '
  'the reason, the actor, the time, and the derived attention state it was '
  'decided against. Append-only: changing your mind writes a new row and the '
  'previous decision stays readable. A RECORD, not a mechanism — nothing reads '
  'it to decide anything, and finding_proposed / finding_confirmed never create '
  'a Finding. "Needs attention" itself is DERIVED and is deliberately not '
  'stored anywhere.';

-- Integrity: the engagement must belong to the writing tenant. Verified here as
-- well as at the route, because a governance record that can point at another
-- tenant's engagement is not an audit trail.
CREATE OR REPLACE FUNCTION vendor_engagement_dispositions_check_refs()
RETURNS TRIGGER AS $$
DECLARE
  ok BOOLEAN;
BEGIN
  SELECT TRUE INTO ok
    FROM vendor_engagements e
   WHERE e.id = NEW.engagement_id
     AND e.organization_id = NEW.organization_id
   LIMIT 1;
  IF ok IS NULL THEN
    RAISE EXCEPTION 'engagement does not exist in this organization'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vendor_engagement_dispositions_check_refs
  ON vendor_engagement_dispositions;
CREATE TRIGGER vendor_engagement_dispositions_check_refs
  BEFORE INSERT OR UPDATE OF engagement_id, organization_id
  ON vendor_engagement_dispositions
  FOR EACH ROW EXECUTE FUNCTION vendor_engagement_dispositions_check_refs();

-- ── Append-only, via the ONE shared guard ──────────────────────────────────
DROP TRIGGER IF EXISTS trg_vendor_engagement_dispositions_worm
  ON vendor_engagement_dispositions;
CREATE TRIGGER trg_vendor_engagement_dispositions_worm
  BEFORE UPDATE OR DELETE ON vendor_engagement_dispositions
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation(
    'append-only (WA-4 ruling 5)', 'is not permitted',
    ' — record a new disposition instead');

DROP TRIGGER IF EXISTS trg_vendor_engagement_dispositions_no_truncate
  ON vendor_engagement_dispositions;
CREATE TRIGGER trg_vendor_engagement_dispositions_no_truncate
  BEFORE TRUNCATE ON vendor_engagement_dispositions
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation(
    'append-only (WA-4 ruling 5)', 'is not permitted',
    ' — record a new disposition instead');

-- ── Tenant isolation ───────────────────────────────────────────────────────
ALTER TABLE vendor_engagement_dispositions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_engagement_dispositions_tenant_isolation
  ON vendor_engagement_dispositions;
CREATE POLICY vendor_engagement_dispositions_tenant_isolation
  ON vendor_engagement_dispositions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Least privilege: no UPDATE, no DELETE for the application path.
GRANT SELECT, INSERT ON vendor_engagement_dispositions TO app_request;
