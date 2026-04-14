-- Migration: evidence_linkage_workflow
-- Package: evidence-linkage-workflow
-- Depends on: evidence-primitives (evidence table),
--             platform-foundation-findings-actions-posture (findings table)
--
-- Expands the evidence.source_type CHECK constraint to include 'finding',
-- allowing evidence to be attached to findings as remediation proof.
--
-- Adds the evidence_summary view for org-scoped aggregate coverage queries.
--
-- This migration is additive. It does not alter existing rows.

-- ---------------------------------------------------------------
-- Expand evidence.source_type CHECK to include 'finding'
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
      'dependency_review',
      'risk_treatment',
      'finding'
    ));
