-- Migration: m1_g1_app_request_grant_catchup
-- Package:   M-1 (A04-G1 phase 3) PR-1 — deliverable M1-G1
-- Design:    docs/M1-app-request-flip-design.md §5 (B-1) + Addendum §B
-- Evidence:  docs/validation/m1-coverage-matrix.md (C-1), 2026-08-17 live census
--
-- WHY
-- ---
-- The 2026-08-17 authoritative census (identical on staging and production)
-- found 21 tables with ZERO app_request grants. Four are intentional Tier D.
-- The other 17 are Option-Y misses: their creating migrations forgot the
-- GRANT that 20260618_create_app_request_role.sql §"Option Y" requires.
-- Post-flip, an ungranted table is a hard 42501 on every touching path.
--
-- BEHAVIOR
-- --------
-- Inert today: app_request has no password and no service connects as it.
-- Grants to an unused role change nothing until the M-1 flip. Idempotent
-- (GRANT re-grants are no-ops), safe to re-apply.
--
-- TIER ASSIGNMENT (from the C-1 matrix's channel evidence — the verb set is
-- the OBSERVED verb set per table, not blanket DML; a future code path that
-- needs a withheld verb fails loudly with 42501 and earns its grant in its
-- own migration)
-- --------------------------------------------------------------------------
--
-- SELECT,INSERT,UPDATE — tenant-path read/write, no observed DELETE:
--   asset_assessments        assetAssessments.ts (asTenant), INSERT+UPDATE
--   risk_approvals           riskApprovals.ts / findings.ts, INSERT+UPDATE
--
-- SELECT,INSERT — tenant-path append + read; UPDATE/DELETE deliberately
-- withheld (append-shaped records):
--   evidence_analysis        vendorPortal.ts + vendorEvidenceAnalysisWorker
--                            (withTenant job bodies), INSERT only
--   intelligence_brief_item_provenance
--                            briefProvenance.ts INSERT under withTenant;
--                            tenant reads via brief routes
--   risk_lifecycle_events    riskLifecycle.ts INSERT only — the lifecycle
--                            ledger stays unmodifiable from the runtime role
--
-- SELECT — tenant-path reads; ALL writes stay on the elevated (owner)
-- ingestion channel:
--   canonical_products             read by assets.ts + findingContextResolver
--   canonical_product_versions     read via findingContextResolver (findings)
--   canonical_product_external_ids read via findingContextResolver (findings)
--   intelligence_events            read by findings.ts / intelligence.ts /
--                                  signal*Links.ts; written by the pipeline
--   intelligence_event_sources     same shape as intelligence_events
--   legal_consents                 tenant reads (historicalAuthorship,
--                                  deletion reaper); consent WRITES are the
--                                  pre-org-context signup surface and move to
--                                  the elevated channel in PR-2 (customerAuth
--                                  pattern)
--
-- NO GRANT — Tier-D extension. These six are system/pipeline-level surfaces
-- with no tenant-path access; the elevated channel is their only legitimate
-- route. Recorded in the C-3 allowlist (test/isolation/appRequestGrants.test.ts)
-- with the same justifications:
--   email_provider_events            provider-webhook + admin evidence surface
--                                    (PR-2 moves its BARE admin/webhook sites
--                                    to pgElevated; sibling of the Tier-D
--                                    webhook_events_processed)
--   feed_health                      pipeline telemetry, elevated-only
--   sources                          source catalog, pipeline-maintained
--   sso_login_codes                  pre-auth surface, elevated-only by design
--   intelligence_event_timeline      event-workflow internals, elevated-only
--   intelligence_event_workflow_triggers  same
--
-- RLS note: asset_assessments, evidence_analysis, risk_approvals,
-- risk_lifecycle_events and intelligence_brief_item_provenance already carry
-- enabled RLS + a policy — the grant is the missing half; the policy applies
-- the moment the flip makes the connection non-owner.

GRANT SELECT, INSERT, UPDATE ON
  asset_assessments,
  risk_approvals
TO app_request;

GRANT SELECT, INSERT ON
  evidence_analysis,
  intelligence_brief_item_provenance,
  risk_lifecycle_events
TO app_request;

GRANT SELECT ON
  canonical_products,
  canonical_product_versions,
  canonical_product_external_ids,
  intelligence_events,
  intelligence_event_sources,
  legal_consents
TO app_request;
