-- Migration: cyber_signals_allow_null_org
-- Sprint 31 — signal pipeline bridge
--
-- 1. Drop NOT NULL on organization_id so globally-ingested signals (not scoped
--    to any org) can be stored. Pipeline signals produced by the intelligence
--    worker are global by design; they are not tied to a specific organization.
--
-- 2. Add a partial unique index on dedup_hash for NULL-org signals.
--    The existing (organization_id, dedup_hash) index handles org-scoped rows.
--    Postgres does not treat NULL = NULL in multi-column unique indexes (pre-15),
--    so a separate partial index is required to deduplicate global signals.
--
-- 3. Expand signal_type CHECK constraint to include bridge-mapped types:
--    'regulatory'     — mapped from worker REGULATION / COMPLIANCE_UPDATE categories
--    'vendor_incident' — mapped from worker VENDOR_RISK category
--    'general'        — mapped from worker AI_GOVERNANCE / GENERAL categories
--
--    These types route correctly through intelligenceBriefGenerator.mapSignalToCategory().

ALTER TABLE cyber_signals
  ALTER COLUMN organization_id DROP NOT NULL;

-- Partial unique index: one global signal per dedup_hash when org is NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cyber_signals_global_dedup
  ON cyber_signals (dedup_hash)
  WHERE organization_id IS NULL;

-- Expand signal_type constraint to include bridge-mapped values.
ALTER TABLE cyber_signals
  DROP CONSTRAINT IF EXISTS cyber_signals_signal_type_check;

ALTER TABLE cyber_signals
  ADD CONSTRAINT cyber_signals_signal_type_check
    CHECK (signal_type IN (
      'cve',
      'threat_actor',
      'advisory',
      'breach',
      'patch',
      'malware',
      'geopolitical',
      'regulatory_change',
      'third_party_breach',
      'data_exposure',
      'patch_advisory',
      'vulnerability',
      'regulatory',
      'vendor_incident',
      'general'
    ));
