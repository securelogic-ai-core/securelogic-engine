-- 20261090_applicability_challenge_and_intake_reason.sql
-- WA-2 (owner ruling 2, 2026-09-04).
--
-- ── THE RULING THIS IMPLEMENTS ─────────────────────────────────────────────
--
-- An analyst or customer may NOT remove an applicable SecureLogic Core
-- Assurance objective — not with a reason, not with a second approver. The
-- Core Assurance Set is a product MINIMUM ASSURANCE FLOOR.
--
-- What they MAY do is:
--   - challenge the applicability determination;
--   - supply corrected factual relationship context;
--   - supply evidence that satisfies the requirement;
--   - add requirements; raise the tier by policy.
--
-- And the distinction the ruling is emphatic about: if new FACTS establish that
-- an objective genuinely does not apply, that is an APPLICABILITY DETERMINATION
-- WITH PROVENANCE — not "an override that removed an applicable requirement".
--
-- ── WHY THIS IS TWO SMALL PIECES AND NOT AN OVERRIDE ENGINE ────────────────
--
-- The fact-corrected path ALREADY WORKS end to end and needed no new machinery:
--
--     new vendor_relationship_intake version (append-only, versioned)
--       -> relationshipClassification re-derives criticality / inherent / tier
--       -> re-compose (scope is mutable until issue)
--       -> a NEW vendor_engagement_composition_snapshots row recording the
--          objective as `not_applicable`, with the facts it read and the rule's
--          own rationale, hashed, beside the previous snapshot which is kept.
--
-- Original determination, changed factual basis, actor, timestamp and
-- historical reproducibility are all preserved by that chain. Exactly ONE
-- element of the ruling's preserve-list was missing from it — the REASON. The
-- intake recorded who and when, never why. Piece 1 adds it.
--
-- Piece 2 is the disagreement itself. There was nowhere to record "SecureLogic
-- says CAS-11 applies and I think it should not" other than a comment thread,
-- so the disagreement either became a silent workaround or was lost. A
-- challenge is a RECORD, not a mechanism: it changes no scope item, no
-- snapshot, no tier and no floor. Nothing in the application reads it to decide
-- anything, and that is deliberate — the moment a challenge could alter a
-- composition it would BE the removal path the ruling forbids.
--
-- The resolution of a challenge is therefore the ordinary product path: correct
-- the facts and compose again. Whether a challenge is still live is DERIVED
-- (its snapshot is no longer the latest), never a mutable status column — an
-- append-only record with a status field is an append-only record with a lie in
-- it.
--
-- ── DELIBERATELY ABSENT ────────────────────────────────────────────────────
--
--   * no `resolution` / `status` / `upheld` column — see above;
--   * no route, anywhere, that deletes or suppresses a scope item;
--   * no nullable actor. A governance act carries a human or it does not
--     happen (the 20261071 posture, applied at birth rather than retrofitted).
--
-- Additive. Both objects are empty at birth. Nothing is backfilled: there is no
-- honest reason to invent for an intake recorded before the column existed.
--
-- Rollback: docs/release/ROLLBACK-20261090.sql

-- ---------------------------------------------------------------
-- 1. Why the facts changed
-- ---------------------------------------------------------------
--
-- NULLABLE on purpose. Every intake recorded before this migration has no
-- reason and never will; a NOT NULL with a manufactured default would put words
-- in a person's mouth on a WORM row. The route requires it for a RE-intake
-- (version > 1), where "why did this change" is a real question — the first
-- intake for a relationship is the baseline and has no prior state to explain.

ALTER TABLE vendor_relationship_intake
  ADD COLUMN IF NOT EXISTS change_reason TEXT NULL;

ALTER TABLE vendor_relationship_intake
  DROP CONSTRAINT IF EXISTS vendor_relationship_intake_change_reason_shape;
ALTER TABLE vendor_relationship_intake
  ADD CONSTRAINT vendor_relationship_intake_change_reason_shape
  CHECK (change_reason IS NULL OR length(trim(change_reason)) BETWEEN 10 AND 2000);

COMMENT ON COLUMN vendor_relationship_intake.change_reason IS
  'Why the declared facts changed, for a re-intake. NULL on the first intake '
  'for a relationship and on every row recorded before WA-2 — never backfilled.';

-- ---------------------------------------------------------------
-- 2. A recorded disagreement with a composition decision
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_engagement_applicability_challenges (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  engagement_id         UUID         NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,

  -- WHICH determination is being challenged, pinned so it stays reproducible.
  -- The snapshot is immutable and hashed; storing the hash BY VALUE as well as
  -- the id means the record still identifies the determination even if the row
  -- it points at is ever unreachable.
  snapshot_id           UUID         NOT NULL
                          REFERENCES vendor_engagement_composition_snapshots(id) ON DELETE RESTRICT,
  snapshot_hash         TEXT         NOT NULL
                          CONSTRAINT vendor_engagement_applicability_challenges_hash_check
                          CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),

  -- RESTRICT, not CASCADE: deleting a requirement must not erase the record
  -- that somebody disputed how it was treated. The reference is stored BY VALUE
  -- beside it because reference ids are editable content.
  requirement_id        UUID         NULL REFERENCES requirements(id) ON DELETE RESTRICT,
  requirement_reference TEXT         NOT NULL
                          CONSTRAINT vendor_engagement_applicability_challenges_reference_nonempty
                          CHECK (length(trim(requirement_reference)) > 0),

  -- What the composition SAID, copied from the snapshot. Keeping SecureLogic's
  -- original determination beside the objection is the ruling's first
  -- preserve-item, and reading it back off a later snapshot would lose it.
  challenged_outcome    TEXT         NOT NULL
                          CONSTRAINT vendor_engagement_applicability_challenges_outcome_check
                          CHECK (challenged_outcome IN
                            ('asked', 'evidence_satisfied', 'not_applicable', 'not_provisioned')),
  -- The customer-facing sentence the composition gave, by value.
  challenged_rationale  TEXT         NULL,

  -- The objection. Same bar as the inherent-risk override: a high-impact
  -- governance act carries its reason or it does not happen.
  reason                TEXT         NOT NULL
                          CONSTRAINT vendor_engagement_applicability_challenges_reason_length
                          CHECK (length(trim(reason)) BETWEEN 10 AND 4000),

  -- NOT NULL. A challenge with no author is an anonymous objection in an audit
  -- trail, which is worse than no record. SET NULL on user delete would
  -- re-introduce exactly that, so the FK is RESTRICT and the erasure path
  -- tombstones users rather than deleting them (accountDeletionReaperPolicy).
  raised_by_user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_engagement_applicability_challenges_engagement
  ON vendor_engagement_applicability_challenges (organization_id, engagement_id, created_at DESC);

COMMENT ON TABLE vendor_engagement_applicability_challenges IS
  'A recorded disagreement with one composition decision: what SecureLogic '
  'determined, which snapshot said it, who objected and why. A RECORD, never a '
  'mechanism — nothing reads it to change a scope, a tier or the Core Assurance '
  'floor. Resolution is the ordinary path: correct the facts and compose again.';

-- Integrity: the engagement and the snapshot must belong to the same org, and
-- the snapshot must belong to the engagement. Cross-row references are verified
-- here as well as at the route, because a record that can point at another
-- tenant's determination is not an audit trail.
CREATE OR REPLACE FUNCTION vendor_engagement_applicability_challenges_check_refs()
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

  ok := NULL;
  SELECT TRUE INTO ok
    FROM vendor_engagement_composition_snapshots s
   WHERE s.id = NEW.snapshot_id
     AND s.organization_id = NEW.organization_id
     AND s.engagement_id = NEW.engagement_id
   LIMIT 1;
  IF ok IS NULL THEN
    RAISE EXCEPTION 'composition snapshot does not belong to this engagement'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vendor_engagement_applicability_challenges_check_refs
  ON vendor_engagement_applicability_challenges;
CREATE TRIGGER vendor_engagement_applicability_challenges_check_refs
  BEFORE INSERT OR UPDATE OF engagement_id, organization_id, snapshot_id
  ON vendor_engagement_applicability_challenges
  FOR EACH ROW EXECUTE FUNCTION vendor_engagement_applicability_challenges_check_refs();

-- Append-only, through the SHARED guard (20261017) — never a private copy, so
-- the certified-erasure exception lives in exactly one function.
DROP TRIGGER IF EXISTS prevent_vendor_engagement_applicability_challenges_row_mutation
  ON vendor_engagement_applicability_challenges;
CREATE TRIGGER prevent_vendor_engagement_applicability_challenges_row_mutation
  BEFORE UPDATE OR DELETE ON vendor_engagement_applicability_challenges
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('append-only (applicability challenges)');

DROP TRIGGER IF EXISTS prevent_vendor_engagement_applicability_challenges_truncate
  ON vendor_engagement_applicability_challenges;
CREATE TRIGGER prevent_vendor_engagement_applicability_challenges_truncate
  BEFORE TRUNCATE ON vendor_engagement_applicability_challenges
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('append-only (applicability challenges)');

ALTER TABLE vendor_engagement_applicability_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_engagement_applicability_challenges_tenant_isolation
  ON vendor_engagement_applicability_challenges;
CREATE POLICY vendor_engagement_applicability_challenges_tenant_isolation
  ON vendor_engagement_applicability_challenges
  USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT ON vendor_engagement_applicability_challenges TO app_request;
