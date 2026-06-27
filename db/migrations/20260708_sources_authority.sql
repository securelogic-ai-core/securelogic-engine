-- Migration: sources_authority
-- Priority 4 / Phase 4B / story B2 — static source-authority seed.
--
-- Populates the `authority` (controlled category) and `authority_tier` (1–5,
-- 1 = most authoritative) columns that B1 (20260707_sources.sql) created but
-- left NULL. The 13 (source -> authority, authority_tier) values mirror the
-- canonical TS map src/api/lib/signals/sourceAuthority.ts; the drift guard
-- src/api/__tests__/signals/sourceAuthorityTable.test.ts fails on any mismatch.
--
-- B2 is STATIC AUTHORITY ONLY. The rolling `reliability` column (derived from
-- feed_health) is a LATER story (B3) and stays NULL here. No application code
-- consumes these columns in B2 — ranking that reads qualification is B4, behind
-- SECURELOGIC_SOURCE_QUALIFICATION_ENABLED, and reads the table, not this seed.
--
-- GLOBAL (not org-scoped): unchanged from B1 — no organization_id, no RLS. The
-- `sources` table remains a deliberate non-tenant table (SHARED-REF); see
-- docs/A04-G1-table-classification.md.
--
-- Additive + idempotent: every statement is re-runnable. The UPDATEs target the
-- PK so re-running is a no-op; the CHECK is added only if absent.
-- Reversible:
--   UPDATE sources SET authority = NULL, authority_tier = NULL;
--   ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_authority_vocab_check;

-- Static authority per source (id + authority + tier). Mirror of SOURCE_AUTHORITY.
UPDATE sources SET authority = 'government',     authority_tier = 1 WHERE source = 'cisa_kev';
UPDATE sources SET authority = 'government',     authority_tier = 1 WHERE source = 'cisa_alerts';
UPDATE sources SET authority = 'government',     authority_tier = 1 WHERE source = 'federal_register';
UPDATE sources SET authority = 'government',     authority_tier = 1 WHERE source = 'sec_edgar';
UPDATE sources SET authority = 'standards_body', authority_tier = 1 WHERE source = 'nvd';
UPDATE sources SET authority = 'research',       authority_tier = 2 WHERE source = 'mitre_attack';
UPDATE sources SET authority = 'research',       authority_tier = 2 WHERE source = 'mitre_atlas';
UPDATE sources SET authority = 'government',     authority_tier = 1 WHERE source = 'nist_news';
UPDATE sources SET authority = 'government',     authority_tier = 1 WHERE source = 'ftc_news';
UPDATE sources SET authority = 'government',     authority_tier = 1 WHERE source = 'onc_healthit';
UPDATE sources SET authority = 'research',       authority_tier = 2 WHERE source = 'sans_isc';
UPDATE sources SET authority = 'security_press', authority_tier = 3 WHERE source = 'krebsonsecurity';
UPDATE sources SET authority = 'security_press', authority_tier = 3 WHERE source = 'bleepingcomputer';

-- Constrain `authority` to the controlled vocabulary (mirrors SourceAuthority).
-- Guarded so the migration stays idempotent (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sources_authority_vocab_check'
  ) THEN
    ALTER TABLE sources
      ADD CONSTRAINT sources_authority_vocab_check
      CHECK (authority IS NULL OR authority IN
        ('government', 'standards_body', 'research', 'security_press'));
  END IF;
END $$;
