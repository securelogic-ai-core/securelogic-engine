-- Migration: signal_match_suggestions
-- Package: signal-match-suggestions
--
-- Creates:
--   signal_match_suggestions — proposals from the (yet-to-be-rewired) matcher
--                              that an external cyber_signal may relate to a
--                              specific platform entity (vendor, ai_system,
--                              control, obligation). Polymorphic by query
--                              against (target_type, target_id) — same shape
--                              as findings (source_type/source_id) and
--                              evidence (source_type/source_id), per the
--                              codebase's established polymorphic-by-query
--                              pattern.
--
--   The suggestion row carries decision state. The accept handler creates
--   the canonical link row in the appropriate signal_*_links table and
--   stores the resulting link id in accepted_link_id. Reverse lookup
--   (which suggestion produced this link?) is satisfied by the
--   (accepted_link_id, target_type) index — same user-facing experience
--   as a per-target-table sidecar without the four-table fan-out.
--
-- Modifies: nothing. Additive only. No alters to cyber_signals, the four
--           signal_*_links tables, or any enum.
--
-- Tenant rules (enforced at the application layer per
--               TENANT_ISOLATION_STANDARD.md §4):
--   - suggestion.organization_id is sourced from req.organizationContext,
--     never from the request body. The matcher will source it from the
--     signal-processing context.
--   - target row (vendors, ai_systems, controls, obligations) MUST belong
--     to suggestion.organization_id — verified by the accept handler at
--     the route layer.
--   - cyber_signals.organization_id MUST equal suggestion.organization_id
--     OR be NULL (global, public-source signals are explicitly cross-org-
--     visible per the standard §1). Same asymmetry as the four link slices.
--
-- Polymorphic FK posture: target_id has NO foreign key — by design, mirroring
--                         findings(source_type, source_id) and evidence
--                         (source_type, source_id). target_type is constrained
--                         to a closed enum via CHECK; target_id existence is
--                         verified at the application layer by the accept
--                         handler before it writes the link row.
--
-- Decision state: a row is exactly one of {pending, accepted, dismissed}.
--   pending   — accepted_at IS NULL AND dismissed_at IS NULL AND accepted_link_id IS NULL
--   accepted  — accepted_at IS NOT NULL AND accepted_link_id IS NOT NULL AND dismissed_at IS NULL
--   dismissed — dismissed_at IS NOT NULL AND accepted_at IS NULL AND accepted_link_id IS NULL
--
-- The state CHECK constraint enforces this at the DB layer; the route
-- handler refuses any state transition out of accepted/dismissed (returns
-- 409). Once terminal, a suggestion stays terminal — the matcher would
-- create a new pending row if it re-suggests the same (org, signal, target)
-- after a dismissal, since the partial unique index excludes terminal rows.

CREATE TABLE IF NOT EXISTS signal_match_suggestions (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  signal_id            UUID         NOT NULL REFERENCES cyber_signals(id) ON DELETE CASCADE,

  -- Polymorphic target. target_id has no FK by design — see header.
  target_type          TEXT         NOT NULL,
  target_id            UUID         NOT NULL,

  -- Matcher provenance. Both nullable — the matcher may evolve to fill
  -- these; rows seeded by other paths (admin tooling, future imports)
  -- need not.
  match_reason         TEXT         NULL,    -- short code: 'vendor_name_ilike', 'cve_match', etc.
  match_score          NUMERIC(4,3) NULL,    -- 0.000..1.000 confidence; NULL when matcher does not score

  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Decision state. Exactly one of {pending, accepted, dismissed} per
  -- the state CHECK below.
  accepted_at          TIMESTAMPTZ  NULL,
  accepted_by_user_id  UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
  accepted_link_id     UUID         NULL,    -- no FK; references the row in the appropriate signal_*_links table identified by target_type

  dismissed_at         TIMESTAMPTZ  NULL,
  dismissed_by_user_id UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
  dismissal_reason     TEXT         NULL,

  CONSTRAINT signal_match_suggestions_target_type_chk
    CHECK (target_type IN ('vendor', 'ai_system', 'control', 'obligation')),

  -- Three-state CHECK. Enforces the {pending, accepted, dismissed} invariant.
  CONSTRAINT signal_match_suggestions_state_chk
    CHECK (
      (accepted_at IS NULL     AND dismissed_at IS NULL  AND accepted_link_id IS NULL)
      OR
      (accepted_at IS NOT NULL AND dismissed_at IS NULL  AND accepted_link_id IS NOT NULL)
      OR
      (dismissed_at IS NOT NULL AND accepted_at IS NULL  AND accepted_link_id IS NULL)
    )
);

-- One PENDING suggestion per (org, signal, target). Excludes terminal rows
-- so the matcher may re-suggest after a prior dismissal. This is also the
-- inference target for ON CONFLICT in any future matcher-side INSERT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_match_suggestions_unique_pending
  ON signal_match_suggestions (organization_id, signal_id, target_type, target_id)
  WHERE accepted_at IS NULL AND dismissed_at IS NULL;

-- Reverse lookup: given a link row, which suggestion produced it?
-- Composite with target_type so the read can scope to one link table
-- without a UNION across the four. Partial — only accepted suggestions
-- carry a link id.
CREATE INDEX IF NOT EXISTS idx_signal_match_suggestions_accepted_link
  ON signal_match_suggestions (accepted_link_id, target_type)
  WHERE accepted_link_id IS NOT NULL;

-- Hot read: list pending suggestions for an org, newest first.
CREATE INDEX IF NOT EXISTS idx_signal_match_suggestions_org_pending
  ON signal_match_suggestions (organization_id, created_at DESC)
  WHERE accepted_at IS NULL AND dismissed_at IS NULL;

-- Hot read: list pending suggestions for a specific signal in an org.
CREATE INDEX IF NOT EXISTS idx_signal_match_suggestions_org_signal_pending
  ON signal_match_suggestions (organization_id, signal_id)
  WHERE accepted_at IS NULL AND dismissed_at IS NULL;
