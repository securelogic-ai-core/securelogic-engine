-- Migration: vendor_engagement_scope
-- Package:   Vendor Assurance — Phase 1/3 (frozen questionnaire scope + responses)
--
-- Persists what scopeResolver.ts computes: the exact requirement set an
-- engagement asks about, and WHY each one is in it.
--
-- ── The freeze is the auditable property ───────────────────────────────────
--
-- Scope items are written once, at `issued`, and never rewritten. A vendor's
-- answers are only meaningful against the questions they were actually asked, so
-- a questionnaire that could change underneath them would make every prior
-- response unverifiable. Changing scope requires a NEW engagement with a
-- parent_engagement_id — the state machine enforces this
-- (isScopeMutable() is false from `issued` onward).
--
-- ── Why the reasons are stored, not recomputed ─────────────────────────────
--
-- `reasons` holds the by-value rule trace from the resolver: every rule that
-- included this requirement, with its rationale. Recomputing it later would give
-- the answer TODAY'S rule corpus produces, not the one that actually governed
-- this engagement — which is the whole reason scope_rule_version is stamped.
--
-- It is also what the portal renders as "why we're asking", so a vendor can see
-- the justification for every question rather than being handed a wall of
-- controls.
--
-- ── requirement_responses gains an engagement, a responder, and history ────
--
-- The shipped table already stores vendor answers (assessment_type='vendor',
-- subject_id=vendor_id) but was answered ONLY by the customer's own staff, and
-- its unique constraint made every save a destructive upsert with no history.
-- Three additive changes fix both:
--
--   engagement_id   which engagement an answer belongs to. Without it, two
--                   engagements with the same vendor would overwrite each other.
--   responder_type  'internal' | 'vendor' — the SAME answer store for both, so
--                   there is one questionnaire truth rather than two.
--   revisions       append-only history, because "what did they say before they
--                   changed it" is an audit question, and an upsert cannot
--                   answer it.
--
-- Additive only. The existing unique constraint is REPLACED with one that
-- includes engagement_id, which is strictly wider — no existing row violates it.

-- ---------------------------------------------------------------
-- vendor_engagement_scope_items
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_engagement_scope_items (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  engagement_id         UUID        NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,
  requirement_id        UUID        NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT,

  -- full: answer + narrative + evidence · confirm: confirm existing assurance
  -- attest: structured answer only
  depth                 TEXT        NOT NULL DEFAULT 'full'
                          CHECK (depth IN ('full', 'confirm', 'attest')),
  mandatory             BOOLEAN     NOT NULL DEFAULT TRUE,

  -- 'deterministic' items were resolved by the rule corpus. 'ai_suggested' ones
  -- are proposals and MUST NOT be shown to a vendor until a human accepts them —
  -- that is the ratified AI boundary, expressed as data.
  source                TEXT        NOT NULL DEFAULT 'deterministic'
                          CHECK (source IN ('deterministic', 'ai_suggested')),
  accepted_at           TIMESTAMPTZ NULL,
  accepted_by_user_id   UUID        NULL REFERENCES users(id) ON DELETE SET NULL,

  -- By-value rule trace: [{ rule_id, rule_family, rationale }]. Rendered to the
  -- vendor as "why we're asking".
  reasons               JSONB       NOT NULL DEFAULT '[]'::jsonb,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vendor_engagement_scope_items_unique UNIQUE (engagement_id, requirement_id),

  -- An AI-suggested item is only in scope once a human accepted it. A
  -- deterministic item needs no acceptance and must not pretend to have one.
  CONSTRAINT vendor_engagement_scope_items_acceptance CHECK (
    (source = 'deterministic' AND accepted_at IS NULL)
    OR source = 'ai_suggested'
  )
);

CREATE INDEX IF NOT EXISTS idx_vendor_engagement_scope_items_engagement
  ON vendor_engagement_scope_items (engagement_id, requirement_id);

CREATE INDEX IF NOT EXISTS idx_vendor_engagement_scope_items_org
  ON vendor_engagement_scope_items (organization_id, engagement_id);

-- The portal's question list: deterministic items, plus accepted AI ones.
CREATE INDEX IF NOT EXISTS idx_vendor_engagement_scope_items_askable
  ON vendor_engagement_scope_items (engagement_id)
  WHERE source = 'deterministic' OR accepted_at IS NOT NULL;

-- ---------------------------------------------------------------
-- requirement_responses — engagement, responder, and real history
-- ---------------------------------------------------------------

ALTER TABLE requirement_responses
  ADD COLUMN IF NOT EXISTS engagement_id  UUID NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE;

ALTER TABLE requirement_responses
  ADD COLUMN IF NOT EXISTS responder_type TEXT NOT NULL DEFAULT 'internal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'requirement_responses_responder_type_check'
  ) THEN
    ALTER TABLE requirement_responses
      ADD CONSTRAINT requirement_responses_responder_type_check
      CHECK (responder_type IN ('internal', 'vendor'));
  END IF;
END $$;

-- Which portal invite authored a vendor answer. NULL for internal answers.
ALTER TABLE requirement_responses
  ADD COLUMN IF NOT EXISTS answered_via_invite_id UUID NULL
    REFERENCES vendor_engagement_invites(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------
-- status vocabulary: 'not_applicable' is NOT 'not_assessed'
-- ---------------------------------------------------------------
-- The shipped CHECK allows pass | fail | partial | not_assessed. Those four
-- cannot express what a vendor actually needs to say, because two of the
-- meanings are being conflated:
--
--   not_assessed    nobody has looked at this yet          (absence of an answer)
--   not_applicable  we looked, and this control does not
--                   apply to our service                   (an answer)
--
-- The control-effectiveness ladder treats them completely differently:
-- not_applicable is EXCLUDED from the effectiveness denominator (which is why it
-- requires a rationale — an unjustified N/A is the easiest way to launder a
-- gap), while not_assessed counts as not_evidenced and scores zero. Forcing a
-- vendor to answer 'not_assessed' for a control that genuinely does not apply
-- would systematically understate every such vendor's effectiveness.
--
-- Widening only: every previously-legal value remains legal, so the recreated
-- constraint validates against all existing rows without a rewrite.
ALTER TABLE requirement_responses
  DROP CONSTRAINT IF EXISTS requirement_responses_status_check;

ALTER TABLE requirement_responses
  ADD CONSTRAINT requirement_responses_status_check
    CHECK (status IN ('pass', 'fail', 'partial', 'not_assessed', 'not_applicable'));

-- The old unique key made every save destructive and could not tell two
-- engagements with the same vendor apart. The replacement includes
-- engagement_id, so it is strictly WIDER — no existing row can violate it.
ALTER TABLE requirement_responses
  DROP CONSTRAINT IF EXISTS requirement_responses_organization_id_requirement_id_asses_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_requirement_responses_unique_scoped
  ON requirement_responses (
    organization_id, requirement_id, assessment_type, subject_id,
    COALESCE(engagement_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS idx_requirement_responses_engagement
  ON requirement_responses (engagement_id, requirement_id)
  WHERE engagement_id IS NOT NULL;

-- ---------------------------------------------------------------
-- requirement_response_revisions — APPEND-ONLY
-- ---------------------------------------------------------------
-- "What did they say before they changed it" is an audit question, and the
-- upsert this replaces could not answer it. Every save writes a revision.

CREATE TABLE IF NOT EXISTS requirement_response_revisions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  response_id           UUID        NOT NULL REFERENCES requirement_responses(id) ON DELETE CASCADE,

  status                TEXT        NOT NULL,
  notes                 TEXT        NULL,

  responder_type        TEXT        NOT NULL CHECK (responder_type IN ('internal', 'vendor')),
  answered_by_user_id   UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  answered_via_invite_id UUID       NULL REFERENCES vendor_engagement_invites(id) ON DELETE SET NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requirement_response_revisions_response
  ON requirement_response_revisions (response_id, created_at DESC);

COMMENT ON TABLE vendor_engagement_scope_items IS
  'The FROZEN questionnaire scope for an engagement. Written once at `issued` and '
  'never rewritten — a vendor''s answers are only meaningful against the questions '
  'they were actually asked. `reasons` holds the by-value rule trace, stored rather '
  'than recomputed because recomputation would give today''s corpus, not the one '
  'that governed this engagement. ai_suggested items are invisible to the vendor '
  'until a human accepts them.';

-- ---------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------

ALTER TABLE vendor_engagement_scope_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_engagement_scope_items_tenant_isolation ON vendor_engagement_scope_items;
CREATE POLICY vendor_engagement_scope_items_tenant_isolation ON vendor_engagement_scope_items
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE requirement_response_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS requirement_response_revisions_tenant_isolation ON requirement_response_revisions;
CREATE POLICY requirement_response_revisions_tenant_isolation ON requirement_response_revisions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- requirement_responses is reachable from the EXTERNAL portal from this release
-- on, so application-layer scoping is no longer sufficient for it.
ALTER TABLE requirement_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS requirement_responses_tenant_isolation ON requirement_responses;
CREATE POLICY requirement_responses_tenant_isolation ON requirement_responses
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_engagement_scope_items   TO app_request;
GRANT SELECT, INSERT, UPDATE, DELETE ON requirement_response_revisions  TO app_request;
