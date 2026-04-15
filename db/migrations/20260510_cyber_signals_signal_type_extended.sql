-- Migration: cyber_signals_signal_type_extended
-- Package: mitre-attack-adapter
-- Depends on: cyber-signal-ingestion (cyber_signals table)
--
-- Expands the cyber_signals signal_type CHECK constraint to include:
--   - Types already accepted by the application validation layer but missing
--     from the DB constraint (regulatory_change, third_party_breach,
--     data_exposure, patch_advisory) — these were added to cyberSignalValidation.ts
--     without a matching migration; this closes that gap.
--   - 'vulnerability' — added for MITRE ATT&CK technique signals, which
--     represent TTPs (Tactics, Techniques, Procedures) rather than CVEs and
--     require a distinct signal_type for proper domain routing and posture
--     scoring attribution.
--
-- NOTE: This migration drops and recreates the CHECK constraint only.
--       No data is modified. The constraint name is preserved from the
--       original migration so it remains identifiable.

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
      'vulnerability'
    ));
