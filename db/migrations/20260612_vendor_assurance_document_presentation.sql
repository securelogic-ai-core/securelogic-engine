-- Migration: vendor_assurance_documents — presentation/restructure package
-- Package: vendor-assurance-document-presentation
--
-- Two changes:
--
--   1. Extend the processing_status state machine. The old per-field
--      Accept/Edit/Reject + Finalize flow is being torn out at the UI layer.
--      The new document-level review surface produces three terminal-ish
--      states:
--        - 'approved'                 — reviewer accepted the extraction
--                                       (the new conceptual replacement for
--                                       'finalized'; no new code path writes
--                                       'finalized')
--        - 'manual_review_requested'  — reviewer flagged the document for a
--                                       human pass; NOT terminal (a future
--                                       human-review action may move it back
--                                       to 'extracted' or forward to
--                                       'approved'/'rejected' — out of scope
--                                       for this package)
--        - 'rejected'                 — reviewer rejected the extraction
--                                       (terminal)
--      'finalized' stays in the CHECK list for backward compatibility with any
--      existing rows; the old finalize route still exists for backward compat
--      (separate cleanup package) so it must remain a legal value.
--
--   2. Add approved_at / approved_by_user_id. We do NOT reuse finalized_at /
--      finalized_by_user_id for the new 'approved' terminal state: the
--      existing vendor_assurance_documents_finalized_consistency CHECK hard-
--      codes processing_status = 'finalized', and that constraint must stay
--      unchanged per the package spec. Reusing the columns would require
--      altering that CHECK, so we add a parallel pair of columns with their
--      own consistency CHECK instead. (Flagged in
--      docs/vendor-assurance-presentation-design.md.)
--
--   3. New table vendor_assurance_field_overrides — append-only record of
--      reviewer overrides of extracted material-field values, with a REQUIRED
--      reason. The current override per (document_id, field_name) is the
--      latest by overridden_at; the UI surfaces it as the displayed value and
--      shows the original on hover. Audit-logged at the route layer via
--      writeAuditEvent('vendor_assurance.field.overridden', ...).
--
-- Tenant rules (TENANT_ISOLATION_STANDARD.md §1, §4, §8):
--   - organization_id is sourced from req.organizationContext at the route layer.
--   - document_id same-org enforcement is application-layer pre-flight in the
--     handler (no composite FK to (document_id, organization_id) — consistent
--     with the existing vendor-assurance tables).
--   - Cross-org reads return 404 from handlers.
--
-- Additive except for the processing_status CHECK swap (widening only — no
-- previously-legal value is removed). No data migration required.

-- ---------------------------------------------------------------
-- 1 + 2. processing_status state machine + approved_* columns
-- ---------------------------------------------------------------

ALTER TABLE vendor_assurance_documents
  DROP CONSTRAINT IF EXISTS vendor_assurance_documents_processing_status_check;

ALTER TABLE vendor_assurance_documents
  ADD CONSTRAINT vendor_assurance_documents_processing_status_check CHECK (
    processing_status IN (
      'pending',
      'extracting',
      'extracted',
      'extraction_failed',
      'finalized',                -- legacy; no new code path writes this
      'approved',
      'manual_review_requested',
      'rejected'
    )
  );

ALTER TABLE vendor_assurance_documents
  ADD COLUMN IF NOT EXISTS approved_at          TIMESTAMPTZ NULL;

ALTER TABLE vendor_assurance_documents
  ADD COLUMN IF NOT EXISTS approved_by_user_id  UUID NULL REFERENCES users(id) ON DELETE SET NULL;

-- Parallel of vendor_assurance_documents_finalized_consistency, for the new
-- 'approved' terminal state. The existing finalized-consistency CHECK is left
-- untouched.
ALTER TABLE vendor_assurance_documents
  DROP CONSTRAINT IF EXISTS vendor_assurance_documents_approved_consistency;

ALTER TABLE vendor_assurance_documents
  ADD CONSTRAINT vendor_assurance_documents_approved_consistency CHECK (
    (approved_at IS NULL     AND approved_by_user_id IS NULL)
    OR
    (approved_at IS NOT NULL AND processing_status = 'approved')
  );

-- ---------------------------------------------------------------
-- 3. vendor_assurance_field_overrides  (APPEND-ONLY)
-- ---------------------------------------------------------------
-- NO UNIQUE on (document_id, field_name). Each override INSERTs a new row;
-- the current override per field = latest by (overridden_at DESC, id DESC).
-- reason is NOT NULL — the route validator additionally rejects empty/blank.

CREATE TABLE IF NOT EXISTS vendor_assurance_field_overrides (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id              UUID         NOT NULL REFERENCES vendor_assurance_documents(id) ON DELETE CASCADE,

  field_name               TEXT         NOT NULL,
  original_value           JSONB        NULL,
  override_value           JSONB        NULL,
  reason                   TEXT         NOT NULL,

  overridden_by_user_id    UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
  overridden_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_field_overrides_document_field
  ON vendor_assurance_field_overrides (document_id, field_name, overridden_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_assurance_field_overrides_org_document
  ON vendor_assurance_field_overrides (organization_id, document_id);
