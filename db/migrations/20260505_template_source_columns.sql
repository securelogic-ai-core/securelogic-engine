-- Migration: template_source_columns
-- Package: industry-starter-templates
--
-- Adds the columns the industry-starter-templates loader needs to attribute
-- inserted rows back to the template that produced them, plus the per-user
-- banner-dismissal state used by the dashboard's templates banner.
--
-- Three concerns are bundled because they ship together:
--
--   1. template_source TEXT NULL on the four destination tables
--      (vendors, ai_systems, obligations, controls). Carries the industry
--      slug ('healthcare-saas' / 'fintech' / 'b2b-ai') for analytics-only
--      attribution. NULL for manually-entered rows; this is the discriminator.
--      Indexed (partial, WHERE NOT NULL) so analytics queries stay cheap
--      without bloating the index for the common manual-entry case.
--
--   2. template_metadata JSONB NULL on vendors only. The curated content
--      carries per-vendor boolean flags (processes_phi, baa_required,
--      processes_pii, processes_payment_data, processes_ai_inference) that
--      have no destination column on vendors. Rather than five booleans,
--      we land them in a single JSONB under a `flags` sub-key:
--        { flags: { processes_phi: true, baa_required: true, ... } }
--      The sub-key keeps room for other template-time metadata in future
--      curation passes without further schema changes. Not on the other
--      three tables because the curation does not produce per-row
--      structured metadata for them.
--
--   3. users.dismissed_banner_keys TEXT[] NOT NULL DEFAULT '{}'. Per-user
--      dismissal state for the dashboard's IndustryTemplatesBanner (and any
--      future dismissible banner). Single column on users — simpler than a
--      separate dismissed_notices table, fast read on every dashboard render,
--      and array-append on dismissal. Defensive note: callers must coalesce
--      to '{}' before appending in case a row arrives with NULL despite the
--      DEFAULT (legacy pre-migration rows during rolling deploys).
--
-- This migration does NOT add framework rows for the templates' referenced
-- frameworks (NIST CSF 2.0, PCI-DSS 4.0.1, ISO 42001, EU AI Act, NY DFS
-- 23 NYCRR 500). Frameworks are org-scoped — the templateLoader upserts the
-- ones a given template references at load time, scoped to the requesting
-- org. There is no global framework reference to populate here.
--
-- IF NOT EXISTS guards: this migration is one of several touching vendors
-- and ai_systems and obligations and controls; rerun-safety is the norm.

-- ============================================================
-- 1. template_source on the four destination tables
-- ============================================================

ALTER TABLE vendors      ADD COLUMN IF NOT EXISTS template_source TEXT NULL;
ALTER TABLE ai_systems   ADD COLUMN IF NOT EXISTS template_source TEXT NULL;
ALTER TABLE obligations  ADD COLUMN IF NOT EXISTS template_source TEXT NULL;
ALTER TABLE controls     ADD COLUMN IF NOT EXISTS template_source TEXT NULL;

-- Partial indexes — only attributable rows are interesting for analytics,
-- and the common case (manual entry, NULL) does not need to be in the index.
CREATE INDEX IF NOT EXISTS idx_vendors_template_source
  ON vendors (template_source) WHERE template_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_systems_template_source
  ON ai_systems (template_source) WHERE template_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_obligations_template_source
  ON obligations (template_source) WHERE template_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_controls_template_source
  ON controls (template_source) WHERE template_source IS NOT NULL;

-- ============================================================
-- 2. template_metadata JSONB on vendors
-- ============================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS template_metadata JSONB NULL;

-- Not indexed. Read alongside the row when needed; no use case yet for
-- filtering by a flag at the query layer (e.g. "find all PHI-processing
-- vendors") — that pattern, if it emerges, gets a partial expression index
-- in a follow-up migration. Don't over-index speculatively.

-- ============================================================
-- 3. users.dismissed_banner_keys
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS dismissed_banner_keys TEXT[] NOT NULL DEFAULT '{}';

-- No index. Per-user reads are by id (PK); no query filters by banner key.
