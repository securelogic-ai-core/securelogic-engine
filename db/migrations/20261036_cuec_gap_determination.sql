-- 20261036_cuec_gap_determination.sql
--
-- CUEC gap determination (VA-1).
--
-- THE GAP THIS CLOSES. A SOC 2 report's Complementary User Entity Controls are
-- the things the VENDOR requires the CUSTOMER to do. They are the single most
-- actionable output of a vendor security review: "here is what this vendor's
-- report obligates you to do, and here is where you fall short."
--
-- SecureLogic could not say the second half. `review_status` accepted only
-- `pending` and `reviewed_no_match`, and that vocabulary CONFLATES TWO OPPOSITE
-- CONCLUSIONS:
--
--     "we looked, and this CUEC does not apply to us"          (fine)
--     "we looked, this applies, and we do not do it"           (a gap)
--
-- Both were recorded identically, so a review could never produce remediation
-- work. 54 documents have been ingested and ZERO findings have ever come out of
-- the document path — not because the promotion code failed, but because the
-- data model had no state that would justify running it.
--
-- ── THE STATE MODEL ────────────────────────────────────────────────────────
--   pending         not reviewed yet. The default; means nothing has been decided.
--   not_applicable  reviewed; the CUEC does not apply to this organisation.
--   satisfied       reviewed; it applies AND the organisation meets it.
--   gap             reviewed; it applies and the organisation does NOT meet it.
--                   This is the state that justifies a Finding.
--   reviewed_no_match  DEPRECATED. Retained so an environment holding legacy rows
--                   does not fail this CHECK. It is deliberately NOT migrated to
--                   any new value: it means "reviewed, nothing matched", which is
--                   exactly the ambiguity above, and silently reinterpreting it
--                   as either `not_applicable` or `gap` would invent a
--                   determination nobody made. Such rows need re-review.
--
-- ── A GAP IS A HUMAN DETERMINATION, ALWAYS ─────────────────────────────────
-- Declaring that an organisation fails a control obligation is consequential:
-- it creates remediation work, it can escalate to the Risk Register, and it may
-- be read by an auditor. AI extraction proposes the CUEC TEXT; it must never be
-- the thing that concludes the organisation is deficient.
--
-- The CHECK below enforces that every consequential state carries a reviewer and
-- a timestamp. `pending` must carry neither. So a gap always has a name and a
-- time attached to it, at the database level, and no code path can produce one
-- without them.
--
-- ── THE BASIS IS SNAPSHOTTED, NOT RECOMPUTED ───────────────────────────────
-- `gap_basis` records WHY the reviewer concluded what they did — which controls
-- the CUEC was mapped to and what their implementation_status was AT THE MOMENT
-- OF THE DECISION. Controls change; a determination made in March must remain
-- explainable in September, and recomputing it later would silently rewrite
-- history. This is the same discipline the platform applies to
-- `sla_due_date_at_request` in the exception path.

ALTER TABLE vendor_assurance_cuecs
  DROP CONSTRAINT IF EXISTS vendor_assurance_cuecs_review_status_check;

ALTER TABLE vendor_assurance_cuecs
  ADD CONSTRAINT vendor_assurance_cuecs_review_status_check
  CHECK (review_status IN (
    'pending',
    'not_applicable',
    'satisfied',
    'gap',
    'reviewed_no_match'
  ));

-- Why the reviewer decided. Snapshotted at decision time; never recomputed.
ALTER TABLE vendor_assurance_cuecs
  ADD COLUMN IF NOT EXISTS gap_basis JSONB;

-- The Finding this gap produced, if it has been promoted. NULL is the normal
-- state: a gap is a determination, and promoting it is a separate act.
ALTER TABLE vendor_assurance_cuecs
  ADD COLUMN IF NOT EXISTS promoted_finding_id UUID
    REFERENCES findings(id) ON DELETE SET NULL;

-- Replaces the old consistency constraint. EVERY reviewed state — not just the
-- one legacy value — must carry who and when. `pending` must carry neither, so a
-- row cannot look reviewed while nobody has looked at it.
ALTER TABLE vendor_assurance_cuecs
  DROP CONSTRAINT IF EXISTS vendor_assurance_cuecs_review_status_consistency;

ALTER TABLE vendor_assurance_cuecs
  ADD CONSTRAINT vendor_assurance_cuecs_review_status_consistency CHECK (
    (review_status = 'pending'
      AND review_status_updated_at IS NULL
      AND review_status_updated_by_user_id IS NULL
      AND review_status_reason IS NULL
      AND gap_basis IS NULL
      AND promoted_finding_id IS NULL)
    OR
    (review_status <> 'pending'
      AND review_status_updated_at IS NOT NULL)
  );

-- Only a gap can have produced a Finding. Prevents a `satisfied` or
-- `not_applicable` CUEC from carrying remediation work it never justified.
ALTER TABLE vendor_assurance_cuecs
  DROP CONSTRAINT IF EXISTS vendor_assurance_cuecs_promotion_requires_gap;

ALTER TABLE vendor_assurance_cuecs
  ADD CONSTRAINT vendor_assurance_cuecs_promotion_requires_gap CHECK (
    promoted_finding_id IS NULL OR review_status = 'gap'
  );

-- The review queue: "which CUECs still need a decision", and "which gaps are not
-- yet promoted". Tenant-first so neither can plan a cross-org scan.
CREATE INDEX IF NOT EXISTS idx_cuecs_org_review_status
  ON vendor_assurance_cuecs (organization_id, review_status);

CREATE INDEX IF NOT EXISTS idx_cuecs_unpromoted_gaps
  ON vendor_assurance_cuecs (organization_id, document_id)
  WHERE review_status = 'gap' AND promoted_finding_id IS NULL;

COMMENT ON COLUMN vendor_assurance_cuecs.review_status IS
  'pending | not_applicable | satisfied | gap | reviewed_no_match(DEPRECATED). `gap` means the CUEC applies to this organisation and it does NOT meet it — the only state that justifies a Finding. `reviewed_no_match` conflates "does not apply" with "we do not do it" and is retained only so legacy rows do not violate the CHECK; it is never auto-migrated because reinterpreting it would invent a determination nobody made.';
COMMENT ON COLUMN vendor_assurance_cuecs.gap_basis IS
  'Why the reviewer decided as they did — the mapped controls and their implementation_status AT THE MOMENT OF DECISION. Snapshotted, never recomputed: controls change, and a determination must stay explainable to an auditor months later.';
COMMENT ON COLUMN vendor_assurance_cuecs.promoted_finding_id IS
  'The Finding this gap produced, if promoted. NULL is normal — a gap is a determination; promoting it is a separate, deliberate act.';
