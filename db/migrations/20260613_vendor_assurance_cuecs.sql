-- Migration: vendor_assurance_cuecs + vendor_assurance_cuec_control_mappings
-- Package: vendor-assurance-cuec-matcher
-- Depends on: 20260610_vendor_assurance_documents, 20260415_control_framework_primitives
--
-- Promotes the SOC extraction's flat `cuecs` array (a JSON array of strings on
-- vendor_assurance_extractions.fields["cuecs"]) into first-class records that
-- get auto-matched against the customer's controls inventory.
--
--   vendor_assurance_cuecs
--     One row per complementary-user-entity-control statement in a document.
--     ordinal = position in the original extracted array (stable ordering;
--     re-extraction / cuecs-field-override does a DELETE-then-INSERT so the
--     ordinals stay 0..n-1 contiguous per document).
--     review_status carries the "user reviewed this CUEC and concluded there is
--     no applicable control in the inventory" fact — a state that is otherwise
--     indistinguishable from "not yet reviewed". We express it on the CUEC row
--     rather than as a sentinel mapping (no fake control row, no controls-
--     inventory pollution).
--
--   vendor_assurance_cuec_control_mappings  (the N:M junction)
--     One row per (cuec, control) pair the matcher proposed or the user
--     created. mapping_status: 'suggested' (matcher proposed, unreviewed) |
--     'accepted' (in effect) | 'dismissed' (user rejected this pair — the
--     matcher will NOT re-suggest a (cuec_id, control_id) pair that already
--     has any row, so a dismissal is durable; re-suggesting after dismissal
--     would be an explicit future UI action). mapping_source: 'auto' (matcher)
--     | 'manual' (user-created, always 'accepted'). mapping_score 0..100 from
--     the LLM matcher, NULL for manual rows. reason is required at the route
--     layer for the 'dismissed' transition (the column itself is nullable so
--     suggested/accepted/manual rows can carry NULL).
--
-- Mapping is its OWN workflow with its own completion state — approving the
-- extraction (Package 1) does not require CUEC mapping to be complete and does
-- NOT lock it (mapping stays editable post-approve, unlike field overrides).
--
-- Tenant rules (TENANT_ISOLATION_STANDARD.md §1, §4, §8):
--   - organization_id is sourced from req.organizationContext at the route
--     layer, never from the body.
--   - cuec / mapping reads scope by organization_id; cross-org → 404.
--   - control_id same-org enforcement is application-layer pre-flight in the
--     mapping-create handler (no composite FK to (control_id, organization_id);
--     consistent with the existing vendor-assurance tables and signal_*_links).
--
-- Additive only. No alters to vendor_assurance_documents,
-- vendor_assurance_extractions, vendor_assurance_field_overrides, controls, or
-- any enum.

-- ---------------------------------------------------------------
-- vendor_assurance_cuecs
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_assurance_cuecs (
  id                              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                 UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id                     UUID         NOT NULL REFERENCES vendor_assurance_documents(id) ON DELETE CASCADE,

  ordinal                         INT          NOT NULL CHECK (ordinal >= 0),
  cuec_text                       TEXT         NOT NULL,

  -- 'pending'           — not yet reviewed for inventory coverage
  -- 'reviewed_no_match' — user reviewed and concluded no applicable control
  review_status                   TEXT         NOT NULL DEFAULT 'pending'
                                    CHECK (review_status IN ('pending', 'reviewed_no_match')),
  review_status_reason            TEXT         NULL,
  review_status_updated_by_user_id UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  review_status_updated_at        TIMESTAMPTZ  NULL,

  created_at                      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT vendor_assurance_cuecs_unique_document_ordinal UNIQUE (document_id, ordinal),

  CONSTRAINT vendor_assurance_cuecs_review_status_consistency CHECK (
    (review_status = 'pending'
       AND review_status_updated_at IS NULL
       AND review_status_updated_by_user_id IS NULL
       AND review_status_reason IS NULL)
    OR
    (review_status = 'reviewed_no_match'
       AND review_status_updated_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_cuecs_document_ordinal
  ON vendor_assurance_cuecs (document_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_cuecs_org_document
  ON vendor_assurance_cuecs (organization_id, document_id);

-- ---------------------------------------------------------------
-- vendor_assurance_cuec_control_mappings  (N:M junction)
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_assurance_cuec_control_mappings (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cuec_id               UUID         NOT NULL REFERENCES vendor_assurance_cuecs(id) ON DELETE CASCADE,
  control_id            UUID         NOT NULL REFERENCES controls(id) ON DELETE CASCADE,

  mapping_status        TEXT         NOT NULL DEFAULT 'suggested'
                          CHECK (mapping_status IN ('suggested', 'accepted', 'dismissed')),
  mapping_score         INT          NULL CHECK (mapping_score IS NULL OR mapping_score BETWEEN 0 AND 100),
  mapping_source        TEXT         NOT NULL CHECK (mapping_source IN ('auto', 'manual')),

  -- Required at the route layer for the 'dismissed' transition; otherwise NULL.
  reason                TEXT         NULL,

  created_by_user_id    UUID         NULL REFERENCES users(id) ON DELETE SET NULL,  -- set for manual rows; NULL for matcher rows
  updated_by_user_id    UUID         NULL REFERENCES users(id) ON DELETE SET NULL,  -- last actor on accept/dismiss
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- One mapping row per (cuec, control) pair, ever. The matcher checks for an
  -- existing row before inserting a suggestion, so a dismissal is durable.
  CONSTRAINT vendor_assurance_cuec_control_mappings_unique_pair UNIQUE (cuec_id, control_id),

  -- A 'manual' row is created by the user as already-accepted; the matcher
  -- never writes 'manual' and never writes anything but 'suggested'.
  CONSTRAINT vendor_assurance_cuec_control_mappings_source_status CHECK (
    mapping_source = 'auto'
    OR (mapping_source = 'manual' AND mapping_status IN ('accepted', 'dismissed'))
  )
);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_cuec_mappings_cuec_status
  ON vendor_assurance_cuec_control_mappings (cuec_id, mapping_status);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_cuec_mappings_control
  ON vendor_assurance_cuec_control_mappings (control_id);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_cuec_mappings_org_cuec
  ON vendor_assurance_cuec_control_mappings (organization_id, cuec_id);
