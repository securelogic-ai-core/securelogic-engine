-- Migration: pen_test_engagement_lifecycle
-- Package:   T2-I (pen-test completion) — 1 of 2: the engagement grows a
--            lifecycle, a methodology, a scope, and a recurrence clock.
--
-- The capability baseline's verdict on this domain, verbatim: "No scope,
-- methodology, retest or evidence model; API-only, no UI." PEN-1 built the UI
-- over what existed; this migration is the "scope, methodology" half of the
-- rest, and 20261042 is the retest half. Everything here is ADDITIVE AND
-- NULLABLE — rows exist (the intake path shipped in the candidate), and a
-- lifecycle imposed retroactively would claim states nobody recorded.
--
-- ── Lifecycle: five states, transitions FREE, the record is the point ───────
-- vendor_engagements needed a state MACHINE because its states gate writes
-- (a frozen questionnaire, a portal, a decision). A pen-test engagement gates
-- nothing: findings arrive by import whenever the report lands, remediation
-- lives on the findings, closure lives on the findings. So `status` here is a
-- STATEMENT OF WHERE THE ENGAGEMENT IS, not a lock: any value may follow any
-- other (a re-opened remediation, a late report addendum), the PATCH route
-- stamps closed_at on entry to 'closed' and clears it on leaving, and the
-- from->to pair is written to the audit log where the history belongs.
-- Inventing an enforcement machine with nothing to enforce would be shape
-- without substance — the delta report called this scope creep's favorite
-- door and it stays shut.
--
-- ── Scope is TEXT, deliberately, for now ────────────────────────────────────
-- Real scope ("these 3 CIDR ranges, this app, NOT the payments API") is prose
-- from a statement of work. Structured per-asset scope would need the asset
-- estate, which is empty pending the PLAT-ASSET-1 ruling (P0-F) — building
-- asset-linked scope today would be a UI over nothing. When that ruling
-- lands, scope items can join the estate the way vulnerability scan runs
-- already do (vulnerability_scan_run_assets); the prose field stays as the
-- narrative either way. Recorded follow-up, not an oversight.
--
-- ── Recurrence is a CLOCK, read-computed, like everywhere else ──────────────
-- next_test_due mirrors ai_systems.next_review_due and
-- vendor_engagements.next_review_due exactly: the routes compute overdue at
-- read (next_test_due < CURRENT_DATE); no worker, no notification sweep until
-- there is a consumer for one. Third domain, same shape, zero new patterns.

ALTER TABLE pen_test_engagements
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'planned';
ALTER TABLE pen_test_engagements
  DROP CONSTRAINT IF EXISTS pen_test_engagements_status_check;
ALTER TABLE pen_test_engagements
  ADD CONSTRAINT pen_test_engagements_status_check CHECK (
    status IN ('planned', 'testing', 'report_received', 'remediation', 'closed')
  );

ALTER TABLE pen_test_engagements
  ADD COLUMN IF NOT EXISTS test_type TEXT NULL;
ALTER TABLE pen_test_engagements
  DROP CONSTRAINT IF EXISTS pen_test_engagements_test_type_check;
ALTER TABLE pen_test_engagements
  ADD CONSTRAINT pen_test_engagements_test_type_check CHECK (
    test_type IS NULL OR test_type IN (
      'network', 'web_application', 'mobile_application', 'api', 'cloud',
      'social_engineering', 'physical', 'red_team', 'other'
    )
  );

-- The approach, in the provider's own words (PTES, OWASP WSTG, bespoke...).
-- Free text: methodologies are named by testers, not by a platform enum.
ALTER TABLE pen_test_engagements
  ADD COLUMN IF NOT EXISTS methodology TEXT NULL;

ALTER TABLE pen_test_engagements
  ADD COLUMN IF NOT EXISTS scope_summary TEXT NULL;

ALTER TABLE pen_test_engagements
  ADD COLUMN IF NOT EXISTS next_test_due DATE NULL;

ALTER TABLE pen_test_engagements
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ NULL;

-- Closed implies stamped; every other state implies not. The PATCH route
-- maintains this and the CHECK makes drift impossible rather than unlikely.
ALTER TABLE pen_test_engagements
  DROP CONSTRAINT IF EXISTS pen_test_engagements_closed_stamped;
ALTER TABLE pen_test_engagements
  ADD CONSTRAINT pen_test_engagements_closed_stamped CHECK (
    (status = 'closed' AND closed_at IS NOT NULL)
    OR (status <> 'closed' AND closed_at IS NULL)
  );

-- The recurrence read path: "which engagements are due", org-wide. Partial —
-- most engagements will carry no clock and must cost nothing here.
CREATE INDEX IF NOT EXISTS idx_pen_test_engagements_next_due
  ON pen_test_engagements (organization_id, next_test_due)
  WHERE next_test_due IS NOT NULL;
