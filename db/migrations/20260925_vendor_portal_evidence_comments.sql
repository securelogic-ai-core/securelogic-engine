-- Migration: vendor_portal_evidence_comments
--
-- The last two capabilities of the external vendor portal: attaching evidence to
-- an engagement, and a two-sided clarification thread.
--
-- ── Why evidence reuses the canonical `evidence` table ────────────────────────
-- A vendor-supplied SOC 2 report is evidence in exactly the sense the platform
-- already models it, and the analysis pipeline, the effectiveness ladder and the
-- org data export all read `evidence`. A parallel `vendor_portal_uploads` table
-- would be a second source of truth for the same object, which is the failure
-- mode this programme exists to remove. So: a new `source_type` value
-- ('vendor_engagement', source_id = the engagement) plus three nullable columns.
--
-- ── The columns, and why each is not derivable ────────────────────────────────
--   engagement_id           denormalised from source_id so an index can serve
--                           "everything for this engagement" without depending
--                           on source_type matching a magic string, and so the
--                           FK CASCADE is real rather than conventional.
--   requirement_id          which QUESTION the file answers. Optional: some
--                           uploads are general (an audit report covering 40
--                           controls), some are specific ("here's the pen test
--                           for AC-2"). The analysis worker needs the link when
--                           it exists and must not invent one when it doesn't.
--   uploaded_via_invite_id  provenance for a file with NO uploading user.
--                           uploaded_by_user_id stays NULL for vendor uploads,
--                           and a NULL there previously meant "system" — which
--                           is now ambiguous. This disambiguates it, and is what
--                           lets an auditor answer "who gave us this document".
--
-- ── Why a separate comments table rather than reusing `comments` ─────────────
-- The platform's existing comment surfaces are internal-only and assume an
-- authenticated author. This thread has an EXTERNAL author with no user row, and
-- a visibility rule that is load-bearing: an internal reviewer must be able to
-- write a note about the vendor that the vendor never sees. Bolting an external
-- author and a visibility flag onto an internal table would put a
-- confidentiality decision on a column that every existing internal call site
-- ignores by default — exactly the shape of an accidental disclosure. This table
-- is small, and its CHECK constraints make the unsafe rows unrepresentable.

-- ---------------------------------------------------------------
-- 1. evidence — accept engagement-sourced, vendor-supplied files
-- ---------------------------------------------------------------

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_source_type_check;

ALTER TABLE evidence
  ADD CONSTRAINT evidence_source_type_check
  CHECK (source_type IN (
    'control_test',
    'vendor_review',
    'ai_review',
    'obligation_review',
    'ai_governance_review',
    'dependency_review',
    'risk_treatment',
    'finding',
    'policy_review',
    'risk',
    'vendor_engagement'
  ));

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS engagement_id          UUID NULL
    REFERENCES vendor_engagements(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS requirement_id         UUID NULL
    REFERENCES requirements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS uploaded_via_invite_id UUID NULL
    REFERENCES vendor_engagement_invites(id) ON DELETE SET NULL;

-- An externally-supplied file must be attributable to the credential that
-- supplied it, and must never masquerade as an internal upload. Both directions
-- are constrained: an invite-attributed row cannot also claim a user, and a
-- vendor_engagement row must carry its engagement.
ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_external_upload_attribution;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_external_upload_attribution CHECK (
    uploaded_via_invite_id IS NULL OR uploaded_by_user_id IS NULL
  );

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_engagement_source_consistent;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_engagement_source_consistent CHECK (
    source_type <> 'vendor_engagement' OR engagement_id IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_evidence_engagement
  ON evidence (organization_id, engagement_id)
  WHERE engagement_id IS NOT NULL;

COMMENT ON COLUMN evidence.uploaded_via_invite_id IS
  'Set when the file was supplied by an EXTERNAL vendor-portal principal rather '
  'than a platform user. uploaded_by_user_id is NULL in that case, so without '
  'this column a vendor-supplied document is indistinguishable from a '
  'system-generated one.';

-- ---------------------------------------------------------------
-- 2. vendor_engagement_comments — the two-sided thread
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_engagement_comments (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  engagement_id          UUID        NOT NULL REFERENCES vendor_engagements(id) ON DELETE CASCADE,

  -- Optional anchor: a clarification about one specific question.
  requirement_id         UUID        NULL REFERENCES requirements(id) ON DELETE SET NULL,

  author_type            TEXT        NOT NULL,
  author_user_id         UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  authored_via_invite_id UUID        NULL REFERENCES vendor_engagement_invites(id) ON DELETE SET NULL,
  author_display_name    TEXT        NULL,

  -- 'vendor'   — both sides see it.
  -- 'internal' — reviewers only. NEVER leaves the authenticated surface.
  visibility             TEXT        NOT NULL DEFAULT 'internal',

  body                   TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vendor_engagement_comments_author_type_check
    CHECK (author_type IN ('vendor', 'internal')),
  CONSTRAINT vendor_engagement_comments_visibility_check
    CHECK (visibility IN ('vendor', 'internal')),
  CONSTRAINT vendor_engagement_comments_body_nonempty
    CHECK (length(trim(body)) > 0),

  -- A vendor-authored comment is attributable to an invite, never to a user, and
  -- can never be marked internal-only. The last clause is the one that matters:
  -- without it a bug could hide a vendor's own message from them while the
  -- reviewer sees it, which reads as a silently dropped reply.
  CONSTRAINT vendor_engagement_comments_vendor_shape CHECK (
    author_type <> 'vendor' OR (
      author_user_id IS NULL
      AND authored_via_invite_id IS NOT NULL
      AND visibility = 'vendor'
    )
  ),
  CONSTRAINT vendor_engagement_comments_internal_shape CHECK (
    author_type <> 'internal' OR authored_via_invite_id IS NULL
  )
);

-- The portal's read is always (engagement, visibility='vendor') ordered by time.
CREATE INDEX IF NOT EXISTS idx_vendor_engagement_comments_thread
  ON vendor_engagement_comments (organization_id, engagement_id, created_at ASC);

COMMENT ON TABLE vendor_engagement_comments IS
  'Two-sided clarification thread for a vendor engagement. `visibility` is a '
  'confidentiality control, not a UI preference: rows default to `internal` so '
  'that a caller which forgets to set it discloses nothing, and the portal read '
  'filters to `vendor` in SQL rather than in application code.';

-- ---------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------

ALTER TABLE vendor_engagement_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_engagement_comments_tenant_isolation ON vendor_engagement_comments;
CREATE POLICY vendor_engagement_comments_tenant_isolation ON vendor_engagement_comments
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_engagement_comments TO app_request;
