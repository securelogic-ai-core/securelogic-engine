-- Migration: evidence_file_attachment
-- Remediation Evidence file upload. The evidence primitive (20260420) stored
-- metadata ONLY — title, type, and an optional external_ref link. But the product
-- tells users to attach real artifacts (screenshots, logs, change tickets), and a
-- gate-enforcing org needs proof, not a link that may rot. This adds the columns
-- that let an evidence row carry an uploaded file stored in R2 (blobStorage.ts),
-- served only via short-lived, org-scoped signed URLs — never a public object URL.
--
-- Six nullable columns. All optional: a reference-only evidence row leaves every
-- one NULL and is completely unaffected (additive, no backfill, reversible). A
-- file-backed row sets them together. `storage_key` is the R2 object key
-- (org/{orgId}/evidence/{evidenceId}/original) and is the discriminator for
-- "this evidence has a file". `uploaded_by_user_id` records WHO uploaded it
-- (created_at already records WHEN), mirroring the actions owner FK semantics.

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS storage_key         TEXT,
  ADD COLUMN IF NOT EXISTS original_filename   TEXT,
  ADD COLUMN IF NOT EXISTS mime_type           TEXT,
  ADD COLUMN IF NOT EXISTS byte_size           BIGINT,
  ADD COLUMN IF NOT EXISTS sha256              TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- A file-backed evidence row must be internally consistent: either it has NO file
-- (all file columns NULL — a reference-only row) or it has the full set that makes
-- a file retrievable and auditable. This prevents a half-written row (e.g. a
-- storage_key with no size/mime) from ever existing.
ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_file_columns_all_or_none;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_file_columns_all_or_none CHECK (
    (storage_key IS NULL
      AND original_filename IS NULL
      AND mime_type IS NULL
      AND byte_size IS NULL
      AND sha256 IS NULL)
    OR
    (storage_key IS NOT NULL
      AND original_filename IS NOT NULL
      AND mime_type IS NOT NULL
      AND byte_size IS NOT NULL
      AND byte_size >= 0
      AND sha256 IS NOT NULL)
  );

-- Org-scoped storage accounting (SUM byte_size of file-backed rows).
CREATE INDEX IF NOT EXISTS idx_evidence_org_storage
  ON evidence (organization_id)
  WHERE storage_key IS NOT NULL;
