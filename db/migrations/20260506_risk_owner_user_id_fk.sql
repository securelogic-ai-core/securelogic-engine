-- 20260506_risk_owner_user_id_fk.sql
--
-- Adds owner_user_id UUID FK → users(id) to risks and risk_treatments.
--
-- The existing `owner` TEXT column on each table is preserved as a
-- denormalized fallback for display when the FK user is later deleted
-- or before this column is populated. On every write, callers should
-- write both columns: owner_user_id (FK) and owner (the FK user's name
-- at write time, for display fallback).
--
-- Strategy: non-breaking addition.
--   * owner_user_id is nullable.
--   * Existing rows keep their `owner` text only.
--   * ON DELETE SET NULL — if the user is removed, the FK clears and
--     display falls back to the denormalized `owner` text.
--
-- This is intentionally distinct from `risk_treatments.reviewer_uuid`
-- (added 20260503), which represents the reviewer/approver role. Owner
-- and reviewer are separate domain concepts and can both apply to a
-- single treatment.

-- ── risks ────────────────────────────────────────────────────────────────────

ALTER TABLE risks
  ADD COLUMN owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_risks_owner_user_id
  ON risks(owner_user_id)
  WHERE owner_user_id IS NOT NULL;

COMMENT ON COLUMN risks.owner_user_id IS
  'FK to users.id for the risk owner. The `owner` TEXT column is the '
  'denormalized fallback (kept in sync on write) used for display when '
  'the FK is null or the referenced user has been deleted.';

-- ── risk_treatments ──────────────────────────────────────────────────────────

ALTER TABLE risk_treatments
  ADD COLUMN owner_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_risk_treatments_owner_user_id
  ON risk_treatments(owner_user_id)
  WHERE owner_user_id IS NOT NULL;

COMMENT ON COLUMN risk_treatments.owner_user_id IS
  'FK to users.id for the treatment owner (the person responsible for '
  'executing the treatment). Distinct from reviewer_uuid (20260503), '
  'which is the approver. The `owner` TEXT column is the denormalized '
  'fallback used for display when the FK is null or the referenced user '
  'has been deleted.';
