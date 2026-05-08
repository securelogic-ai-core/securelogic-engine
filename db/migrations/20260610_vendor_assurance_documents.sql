-- Migration: vendor_assurance_documents
-- Package: vendor-assurance-intelligence-phase-1
--
-- Adds the four tables that back the vendor-assurance intelligence capability:
--   vendor_assurance_documents          — uploaded SOC PDF metadata; owns processing state
--   vendor_assurance_extractions        — one extraction per document; one extraction per
--                                         document in Phase 1 (no re-extraction flow)
--   vendor_assurance_extraction_spans   — per-field source-text spans for material conclusions
--   vendor_assurance_review_decisions   — APPEND-ONLY; current decision per field is
--                                         computed at read time as latest-by-decided_at
--
-- Tenant rules (TENANT_ISOLATION_STANDARD.md §1, §4, §8):
--   - organization_id is sourced from req.organizationContext at the route layer.
--   - vendor_id same-org enforcement is application-layer pre-flight in the handler
--     (no composite FK to (vendor_id, organization_id) — would require adding a
--     composite unique on vendors.id, out of scope).
--   - Cross-org reads return 404 from handlers.
--
-- Storage rules (TENANT_ISOLATION_STANDARD.md §5):
--   - storage_key MUST be the absolute key org/{organization_id}/vendor-assurance/
--     {document_id}/original.pdf, written via vendorAssuranceStorage.ts (which
--     wraps blobStorage.ts; routes never call blobStorage.ts directly).
--
-- Append-only invariant on vendor_assurance_review_decisions:
--   - NO UNIQUE on (extraction_id, field_name).
--   - Each accept/edit/reject inserts a NEW row.
--   - Current decision per field = latest by decided_at, broken by id DESC.
--   - The composite index (organization_id, extraction_id, field_name,
--     decided_at DESC, id DESC) supports the DISTINCT ON read projection.
--
-- This migration is additive only. No alters to existing tables. No enum changes.
-- No changes to findings.source_type CHECK. No changes to evidence.source_type CHECK.

-- ---------------------------------------------------------------
-- vendor_assurance_documents
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_assurance_documents (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id                UUID         NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  uploaded_by_user_id      UUID         NULL REFERENCES users(id) ON DELETE SET NULL,

  original_filename        TEXT         NOT NULL,
  byte_size                BIGINT       NOT NULL CHECK (byte_size > 0),
  sha256                   TEXT         NOT NULL,
  storage_key              TEXT         NOT NULL,
  mime_type                TEXT         NOT NULL CHECK (mime_type = 'application/pdf'),

  document_type_hint       TEXT         NULL CHECK (
    document_type_hint IS NULL
    OR document_type_hint IN ('soc1', 'soc2_type1', 'soc2_type2')
  ),

  processing_status        TEXT         NOT NULL DEFAULT 'pending' CHECK (
    processing_status IN ('pending', 'extracting', 'extracted', 'extraction_failed', 'finalized')
  ),
  processing_error_code    TEXT         NULL,
  processing_error_detail  TEXT         NULL,

  finalized_at             TIMESTAMPTZ  NULL,
  finalized_by_user_id     UUID         NULL REFERENCES users(id) ON DELETE SET NULL,

  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT vendor_assurance_documents_finalized_consistency CHECK (
    (finalized_at IS NULL     AND finalized_by_user_id IS NULL)
    OR
    (finalized_at IS NOT NULL AND processing_status = 'finalized')
  )
);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_documents_org_vendor_created
  ON vendor_assurance_documents (organization_id, vendor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_documents_org_status_created
  ON vendor_assurance_documents (organization_id, processing_status, created_at DESC);

-- ---------------------------------------------------------------
-- vendor_assurance_extractions
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_assurance_extractions (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id              UUID         NOT NULL REFERENCES vendor_assurance_documents(id) ON DELETE CASCADE,

  model_id                 TEXT         NOT NULL,
  prompt_version           TEXT         NOT NULL,
  raw_response_excerpt     TEXT         NULL,

  -- 'fields' is a strictly-validated JSONB document. Per material field name:
  --   { value: <string|date|enum|array>, confidence: 0..1, status: 'extracted' }
  -- Shape is enforced by socExtractionValidator.ts BEFORE insert.
  fields                   JSONB        NOT NULL,

  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- One extraction per document in Phase 1; no re-extraction flow exists.
  -- A failed document requires re-upload to retry.
  CONSTRAINT vendor_assurance_extractions_one_per_document UNIQUE (document_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_extractions_org_document
  ON vendor_assurance_extractions (organization_id, document_id);

-- ---------------------------------------------------------------
-- vendor_assurance_extraction_spans
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_assurance_extraction_spans (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  extraction_id            UUID         NOT NULL REFERENCES vendor_assurance_extractions(id) ON DELETE CASCADE,

  field_name               TEXT         NOT NULL,
  page_number              INT          NULL CHECK (page_number IS NULL OR page_number > 0),
  char_start               INT          NOT NULL CHECK (char_start >= 0),
  char_end                 INT          NOT NULL CHECK (char_end >= char_start),
  quote                    TEXT         NOT NULL,

  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_extraction_spans_org_ext_field
  ON vendor_assurance_extraction_spans (organization_id, extraction_id, field_name);

-- ---------------------------------------------------------------
-- vendor_assurance_review_decisions  (APPEND-ONLY)
-- ---------------------------------------------------------------
-- NO UNIQUE on (extraction_id, field_name). The append-only invariant is the
-- contract: each decision insert creates a new row; the current decision per
-- field is the latest by (decided_at DESC, id DESC).

CREATE TABLE IF NOT EXISTS vendor_assurance_review_decisions (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  extraction_id            UUID         NOT NULL REFERENCES vendor_assurance_extractions(id) ON DELETE CASCADE,

  field_name               TEXT         NOT NULL,
  decision                 TEXT         NOT NULL CHECK (decision IN ('accept', 'edit', 'reject')),

  -- Non-null when decision='edit'; handler validator enforces this.
  reviewed_value           JSONB        NULL,
  reviewer_note            TEXT         NULL,

  decided_by_user_id       UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
  decided_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Composite index supporting the DISTINCT ON (field_name) ORDER BY
-- (field_name, decided_at DESC, id DESC) read projection used by every
-- current-decision-per-field read.
CREATE INDEX IF NOT EXISTS idx_vendor_assurance_review_decisions_projection
  ON vendor_assurance_review_decisions
     (organization_id, extraction_id, field_name, decided_at DESC, id DESC);
