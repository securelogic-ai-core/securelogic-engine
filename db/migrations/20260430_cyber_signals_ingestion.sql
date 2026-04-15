-- Migration: cyber_signals_ingestion
-- Package: cyber-signal-ingestion
-- Depends on:
--   platform-foundation-findings-actions-posture (findings table)
--   risk-register-primitives (risks table)
--
-- Creates:
--   cyber_signals — external cyber security signal records ingested from
--                   any source (CISA KEV, NVD, RSS, manual, mock/seed).
--
-- Modifies:
--   risks    — adds exposure_flagged, exposure_signal_id columns so that
--              the signal-to-risk linker can flag which open risks have
--              newly detected external exposure.
--   findings — expands source_type CHECK constraint to include 'cyber_signal'.
--
-- Design decisions:
--   source column has NO CHECK constraint. The source list is intentionally
--   extensible (CISA, NVD, RSS, internal adapters). Application layer validates
--   against a known set; DB does not block unknown sources.
--
--   signal_type IS constrained — forms the canonical taxonomy used for
--   domain routing (Vendor Risk, AI Governance, Vulnerability, General) and
--   posture scoring attribution. New types require a migration to ensure
--   the scoring engine handles them explicitly.
--
--   dedup_hash is UNIQUE per (organization_id) — one signal per org per
--   normalized key. Two orgs ingesting the same CVE each get their own row.
--   Two adapters (CISA and NVD) reporting the same CVE from the same source
--   are considered distinct signals (different source in hash).

-- ---------------------------------------------------------------
-- cyber_signals
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cyber_signals (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Signal provenance
  source              TEXT        NOT NULL,
  signal_type         TEXT        NOT NULL,
  severity            TEXT        NOT NULL,

  -- Payload
  raw_payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  normalized_summary  TEXT        NOT NULL,

  -- Affected entity fields — nullable; used for vendor/AI system matching
  -- and deduplication. affected_cve is normalized to uppercase (CVE-YYYY-NNNNN).
  affected_vendor     TEXT        NULL,
  affected_cve        TEXT        NULL,

  -- SHA-256 of: source|signal_type|affected_cve|affected_vendor (all lowercased).
  -- Prevents re-ingesting the same logical event from the same source.
  dedup_hash          TEXT        NOT NULL,

  -- Processing state
  ingestion_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed           BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Populated after processing if a matching vendor/AI system was found.
  linked_finding_id   UUID        NULL REFERENCES findings(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cyber_signals_signal_type_check CHECK (
    signal_type IN (
      'cve',
      'threat_actor',
      'advisory',
      'breach',
      'patch',
      'malware',
      'geopolitical'
    )
  ),
  CONSTRAINT cyber_signals_severity_check CHECK (
    severity IN ('Critical', 'High', 'Moderate', 'Low')
  )
);

-- Deduplication: one signal per (org, hash).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cyber_signals_dedup
  ON cyber_signals (organization_id, dedup_hash);

-- Primary list access pattern: newest first, per org.
CREATE INDEX IF NOT EXISTS idx_cyber_signals_org_created
  ON cyber_signals (organization_id, created_at DESC, id DESC);

-- Unprocessed filter — used when running the processing pipeline.
CREATE INDEX IF NOT EXISTS idx_cyber_signals_org_unprocessed
  ON cyber_signals (organization_id, ingestion_timestamp DESC)
  WHERE processed = FALSE;

-- Signal type filter.
CREATE INDEX IF NOT EXISTS idx_cyber_signals_org_signal_type
  ON cyber_signals (organization_id, signal_type);

-- ---------------------------------------------------------------
-- Add exposure tracking to risks
-- ---------------------------------------------------------------

ALTER TABLE risks
  ADD COLUMN IF NOT EXISTS exposure_flagged   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exposure_signal_id UUID    NULL
    REFERENCES cyber_signals(id) ON DELETE SET NULL;

-- Partial index — only flagged risks need this lookup path.
CREATE INDEX IF NOT EXISTS idx_risks_org_exposure_flagged
  ON risks (organization_id)
  WHERE exposure_flagged = TRUE;

-- ---------------------------------------------------------------
-- Expand findings.source_type to include 'cyber_signal'
--
-- 'cyber_signal' identifies findings auto-created by the signal
-- ingestion pipeline when a signal matches a known vendor or AI system.
-- This is distinct from 'signal' (Intelligence Brief pipeline signals).
-- ---------------------------------------------------------------

ALTER TABLE findings
  DROP CONSTRAINT IF EXISTS findings_source_type_check;

ALTER TABLE findings
  ADD CONSTRAINT findings_source_type_check
    CHECK (source_type IN (
      'assessment',
      'control_test',
      'vendor_review',
      'vendor_cycle_review',
      'ai_review',
      'ai_governance_review',
      'obligation_review',
      'dependency_review',
      'cyber_signal',
      'signal',
      'manual',
      'risk'
    ));
