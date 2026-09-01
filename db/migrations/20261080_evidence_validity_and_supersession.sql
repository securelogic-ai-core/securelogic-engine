-- 20261080 — ADR-0012 Step 2, part 1 of 3. Evidence validity, supersession,
-- and the assurance-class axis.
--
-- ── WHY THIS IS 20261080 AND NOT 20261051 ──────────────────────────────────
--
-- ADR-0012 (RATIFIED 2026-08-22) authorised migrations 20261051–20261055 for
-- T2-A and reserved them in the freeze-window schema ledger. Those slots were
-- never consumed: the package was gated behind the promotion and the held
-- train, and in the meantime the repository migration floor advanced to 20261079
-- (VA-S4-4C-4, applied on staging 2026-08-31 23:17:17Z).
--
-- The runner is FILENAME-keyed, so applying 20261051 today would in fact work.
-- It is still wrong. A file numbered below the applied floor reads as though it
-- shipped before work it actually follows, and a from-scratch rebuild would
-- order it before the tables it depends on having been reasoned about. Owner
-- direction, 2026-09-01: re-slot to the next sequential range and preserve the
-- original authorisation in the record. The ADR's reservation stands as a
-- historical fact; 20261051–55 are hereby RETIRED UNUSED and must not be
-- claimed by anything else.
--
--   ADR-0012 §4 reservation → implemented slot
--     20261051 evidence validity + supersession   → 20261080 (this file)
--     20261052 evidence_links                     → 20261081
--     20261053 origin-link backfill               → NOT BUILT (see below)
--     20261054 evidence_lifecycle_events          → 20261082
--     20261055 vendor_assurance_document source   → NOT IN SCOPE (ADR §6.3)
--
-- ── THE BACKFILL THAT IS DELIBERATELY ABSENT ───────────────────────────────
--
-- ADR-0012 §2.1 describes a backfill: one link_kind='origin' row per live
-- evidence row, copying reviewed_* into confirmed_*. THAT BACKFILL IS NOT
-- BUILT, by owner direction 2026-09-01: preserve existing evidence history, and
-- fabricate no historical validity, confirmation, link or lifecycle event for
-- legacy evidence. Fail closed where historical state cannot be known.
--
-- The consequence is stated plainly rather than discovered later: every
-- pre-existing evidence row lands with validity_basis='not_established' and
-- assurance_class='unclassified', and owns NO link. Under the new counting
-- predicate (evidenceLifecycleContract.ts) such a row counts for NOTHING. That
-- is the fail-closed reading of an unknown history, and it is exactly why the
-- predicate is not wired to anything in this package and why
-- SECURELOGIC_EVIDENCE_LIFECYCLE_V2 ships default-off: flipping it against an
-- unmigrated estate would silently drop every legacy proof. A curation path for
-- legacy evidence is owed BEFORE that flag can ever be considered.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ────────────────────────────────────────
--
-- It changes no counting behaviour. The closure gate, the effectiveness ladder,
-- posture and residual risk read exactly the columns they read yesterday. S4 is
-- not wired, assuranceCoveredRequirementIds is not called, and no questionnaire
-- depth changes. This is dark schema.
--
-- Reversible: docs/release/ROLLBACK-20261080.sql.

-- ---------------------------------------------------------------
-- 1. Validity — what the artifact ASSERTS, not when we received it
-- ---------------------------------------------------------------

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS valid_from      DATE NULL,
  ADD COLUMN IF NOT EXISTS valid_until     DATE NULL,
  ADD COLUMN IF NOT EXISTS validity_basis  TEXT NOT NULL DEFAULT 'not_established';

COMMENT ON COLUMN evidence.valid_from IS
  'Start of the coverage window the ARTIFACT asserts (a SOC 2 period start, a '
  'certificate issue date, a test end date). Never derived from uploaded_at. '
  'ADR-0012 §2.2.';

COMMENT ON COLUMN evidence.valid_until IS
  'End of the coverage window the ARTIFACT asserts. NULL means one of two very '
  'different things, and validity_basis is what tells them apart: unknown '
  '(not_established) or genuinely without end (perpetual). Reading NULL as '
  '"no expiry" without consulting validity_basis is the defect this column pair '
  'exists to prevent.';

-- The discriminator. This column is an addition beyond ADR-0012 §4's literal
-- two-column list, and the reason is the owner's fail-closed direction: without
-- it, "we do not know this artifact's validity" and "this artifact never
-- expires" are the same NULL, and a predicate must then guess. A guess in this
-- position always resolves in favour of counting stale evidence, which is the
-- precise governance failure T2-A exists to prevent.
--
-- 'policy_default' is deliberately ABSENT from the vocabulary. Durations are
-- Step 3 and are NOT ratified; shipping a value that only a ratified policy
-- could produce would imply a policy exists. Step 3 adds it, in its own
-- migration, on the day it is approved.
ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_validity_basis_check;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_validity_basis_check CHECK (
    validity_basis IN ('not_established', 'artifact_dates', 'perpetual')
  );

COMMENT ON COLUMN evidence.validity_basis IS
  'WHY this row''s window is what it is. not_established = unknown, the '
  'fail-closed default every pre-existing row carries; artifact_dates = a human '
  'committed a window the artifact itself states; perpetual = the artifact '
  'asserts no end (a contract until terminated). Step 3 will add a '
  'policy_default value when durations are ratified — not before.';

-- Shape, per basis. Each arm is the honest representation of its own state.
ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_validity_shape_check;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_validity_shape_check CHECK (
    (validity_basis = 'not_established'
       AND valid_from IS NULL AND valid_until IS NULL)
    OR
    (validity_basis = 'artifact_dates'  AND valid_until IS NOT NULL)
    OR
    (validity_basis = 'perpetual'       AND valid_until IS NULL)
  );

-- A window that ends before it starts is not a window.
ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_validity_ordering_check;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_validity_ordering_check CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until
  );

-- The counting predicate's index: org-scoped, live-window lookups.
CREATE INDEX IF NOT EXISTS idx_evidence_org_validity
  ON evidence (organization_id, valid_until)
  WHERE validity_basis <> 'not_established';

-- ---------------------------------------------------------------
-- 2. Supersession — a renewed artifact is a NEW ROW
-- ---------------------------------------------------------------
--
-- ADR-0012 §2.4: no stamped superseded_by. "Current" is derived at read as
-- NOT EXISTS (a newer row pointing here) — the fifth domain on that pattern.
-- History is never destroyed and open links are never auto-detached; a human
-- relinks. ON DELETE RESTRICT because a version chain that can lose its middle
-- is not a chain.

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS supersedes_evidence_id UUID NULL
    REFERENCES evidence(id) ON DELETE RESTRICT;

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_no_self_supersession_check;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_no_self_supersession_check CHECK (
    supersedes_evidence_id IS NULL OR supersedes_evidence_id <> id
  );

-- Linear chains: at most one successor per version. Without this, two renewals
-- of the same artifact both claim currency and "is there a newer row" has two
-- answers.
CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_supersession_linear
  ON evidence (supersedes_evidence_id)
  WHERE supersedes_evidence_id IS NOT NULL;

COMMENT ON COLUMN evidence.supersedes_evidence_id IS
  'The version this row replaces. ADR-0012 §2.4: versioning is a new row, '
  'currency is derived at read (NOT EXISTS a newer row), and the superseded row '
  'keeps its own links and confirmations. Nothing auto-detaches.';

-- A version chain must not cross a tenant boundary. RLS stops a tenant READING
-- another tenant's row, but a foreign key is not org-aware, so the invariant is
-- enforced here. INSERT/UPDATE only — this trigger deliberately mentions no
-- DELETE or TRUNCATE, so it stays outside the shared WORM guard's remit
-- (wormGuardConsolidation.test.ts asserts every delete/truncate trigger in the
-- database resolves to worm_guard_mutation).
CREATE OR REPLACE FUNCTION evidence_supersession_same_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  parent_org UUID;
BEGIN
  IF NEW.supersedes_evidence_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT organization_id INTO parent_org
    FROM evidence WHERE id = NEW.supersedes_evidence_id;

  IF parent_org IS NULL OR parent_org <> NEW.organization_id THEN
    RAISE EXCEPTION
      'evidence % cannot supersede evidence % across an organization boundary',
      NEW.id, NEW.supersedes_evidence_id
      USING ERRCODE = '23514',
            HINT = 'A version chain is tenant-local. Superseding another '
                   'organisation''s artifact would import their evidence into '
                   'your posture.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evidence_supersession_same_org ON evidence;
CREATE TRIGGER trg_evidence_supersession_same_org
  BEFORE INSERT OR UPDATE ON evidence
  FOR EACH ROW EXECUTE FUNCTION evidence_supersession_same_org();

-- ---------------------------------------------------------------
-- 3. assurance_class — the orthogonal axis evidence_type is not
-- ---------------------------------------------------------------
--
-- Per docs/design/VA-EVIDENCE-validity-policy-proposal.md §2, corrected
-- 2026-08-29: evidence_type is NOT unconstrained — it is a closed FORM
-- vocabulary (document / screenshot / log / …), and a SOC 2 report, a DPA, an
-- ISO certificate and a pen-test report are all 'document'. What is missing is
-- the ASSURANCE CLASS the Step 3 validity policy keys on. This adds that axis;
-- it does not touch evidence_type, which every existing reader depends on.
--
-- TEXT + CHECK + a mirrored code constant with a lockstep test, per the ruling
-- to follow the repository's existing closed-vocabulary pattern rather than
-- reach for a Postgres ENUM (an ENUM value cannot be removed or reordered
-- without a type rewrite, which makes governed vocabulary evolution a hazard).
--
-- NO DETERMINISTIC BACKFILL from document_type_hint or pen_test test_type. The
-- proposal contemplates one; the owner's 2026-09-01 direction forbids inferring
-- historical state. A hint is a hint, and every existing row is therefore
-- 'unclassified' — observable, and fail-safe exactly as 'uncurated' is for
-- scope tags (20261064).

ALTER TABLE evidence
  ADD COLUMN IF NOT EXISTS assurance_class TEXT NOT NULL DEFAULT 'unclassified';

ALTER TABLE evidence
  DROP CONSTRAINT IF EXISTS evidence_assurance_class_check;
ALTER TABLE evidence
  ADD CONSTRAINT evidence_assurance_class_check CHECK (
    assurance_class IN (
      'unclassified',            -- never silently anything else
      'soc1',                    -- §3.1
      'soc2_type1',              -- §3.1 — a point-in-time DESIGN opinion
      'soc2_type2',              -- §3.1 — operating effectiveness over a period
      'iso_certification',       -- §3.2
      'pen_test',                -- §3.3
      'vulnerability_scan',      -- §3.4
      'policy_document',         -- §3.5
      'bcp_dr_test',             -- §3.6
      'technical_configuration', -- §3.7
      'vendor_attestation',      -- §3.8
      'privacy_agreement',       -- §3.9
      'subprocessor_list',       -- §3.9 — deliberately NOT the same class as the DPA
      'ai_evaluation',           -- §3.10
      'contract',                -- §3.11
      'other_assurance_report'   -- §3.12 — HITRUST, PCI AOC, CSA STAR, …
    )
  );

COMMENT ON COLUMN evidence.assurance_class IS
  'WHAT KIND OF ASSURANCE this artifact is — the axis the Step 3 validity '
  'policy keys on, orthogonal to evidence_type (form) and source_type (origin '
  'workflow). ''unclassified'' is the fail-safe default and carries NO validity: '
  'an artifact whose class nobody has established must never inherit a duration. '
  'soc2_type1 and soc2_type2 are separate values on purpose — a Type I attests '
  'design at a point in time and can never establish that a control OPERATED.';

CREATE INDEX IF NOT EXISTS idx_evidence_org_assurance_class
  ON evidence (organization_id, assurance_class)
  WHERE assurance_class <> 'unclassified';
