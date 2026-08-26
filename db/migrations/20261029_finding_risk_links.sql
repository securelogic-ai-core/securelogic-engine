-- 20261029_finding_risk_links.sql
--
-- Findings ↔ Risk Register (SL-RISK-LINK).
--
-- ── WHY A JOIN TABLE, AND NOT THE COLUMNS WE ALREADY HAVE ──────────────────
-- `risks.source_type` already accepts 'finding' and `risks.source_id` can hold
-- a finding id, so it is tempting to call this solved. It is not, for two
-- reasons that matter:
--
--   1. IT IS SINGLE-VALUED. A risk can name exactly one origin. The governance
--      requirement is the opposite shape: SEVERAL findings — a pen-test
--      result, a vendor gap and a control deficiency — evidencing ONE register
--      entry. That cannot be squeezed into a scalar column.
--   2. IT IS UNVERIFIED. risks.ts documents source_type/source_id as
--      "unverified provenance metadata ... not FK-verified against any source
--      table". Provenance is a note; a relationship the register is reported
--      from has to be a constraint.
--
-- source_type/source_id keeps its existing meaning — "where this risk was
-- first identified" — and is untouched. This table carries the relationship.
--
-- ── WHY NOT A SECOND REGISTER, AND WHY NOT A NEW FINDING MODEL ─────────────
-- Neither object changes. `findings` gains no column and `risks` gains no
-- column; a finding with no rows here is exactly what it is today. Standalone
-- is the DEFAULT and stays the default: nothing in this migration or its code
-- creates a link on its own.
--
-- ── PROMOTION IS A HUMAN ACT ───────────────────────────────────────────────
-- `link_type` records HOW the relationship came to exist:
--   'linked'   — a person attached this finding to a risk that already existed
--   'promoted' — a person created this risk FROM this finding
-- Both are human-initiated. The column exists so that a future assistant can
-- one day RECOMMEND a link without the recommendation being indistinguishable
-- from a decision: a suggestion would arrive as a separate, clearly-provisional
-- object, and would still have to be accepted by a person to become a row here.
--
-- ── AUDIT ──────────────────────────────────────────────────────────────────
-- Link, unlink and promotion are written to security_audit_log
-- (finding.risk_linked / finding.risk_unlinked / finding.promoted_to_risk),
-- which is append-only and survives the row being deleted. Unlinking DELETES
-- this row on purpose: a link that no longer holds should not keep appearing
-- in a register report, and the history lives in the audit stream where it
-- cannot be confused with a live relationship.
--
-- ── FORWARD COMPATIBILITY ──────────────────────────────────────────────────
-- Nothing here is source-specific. A finding from a pen test, a CVE, Vendor
-- Assurance, a control deficiency, an audit, AI governance or intelligence
-- uses this same table, because the relationship is finding→risk and the
-- finding's origin is already carried by findings.source_type.
--
-- Policy-driven SLAs are unaffected and stay possible: this migration touches
-- neither findings.due_date, findings.requirement_id nor
-- risk_settings.finding_sla_by_severity.

CREATE TABLE IF NOT EXISTS finding_risks (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  finding_id         UUID        NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  risk_id            UUID        NOT NULL REFERENCES risks(id)    ON DELETE CASCADE,

  link_type          TEXT        NOT NULL DEFAULT 'linked'
    CHECK (link_type IN ('linked', 'promoted')),

  -- Why this finding belongs to this risk, in the linker's words. Optional,
  -- and deliberately free text: a reviewer reading the register a year later
  -- needs the reasoning more than a taxonomy.
  note               TEXT        NULL,

  created_by_user_id UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One relationship per pair. Re-linking an already-linked pair is a no-op,
  -- not a duplicate: a register that counts the same finding twice overstates
  -- its own evidence.
  CONSTRAINT finding_risks_unique UNIQUE (organization_id, finding_id, risk_id)
);

-- "Which risks does this finding support?" — the finding-detail panel.
CREATE INDEX IF NOT EXISTS idx_finding_risks_finding
  ON finding_risks (organization_id, finding_id);

-- "Which findings evidence this risk?" — the register-entry panel, and the
-- roll-up that makes many-to-one worth having.
CREATE INDEX IF NOT EXISTS idx_finding_risks_risk
  ON finding_risks (organization_id, risk_id);

-- ── TENANT ISOLATION ───────────────────────────────────────────────────────
-- A relationship table is a cross-object join, which makes it the most
-- attractive place to leak: the ids of two other tenants' objects are enough
-- to fabricate a row unless the policy forbids it. The WITH CHECK arm is what
-- stops a write; USING alone would only hide reads.
--
-- The org predicate on the ROW is necessary but not sufficient — a caller
-- could still name another org's finding_id. The route therefore re-verifies
-- BOTH endpoints against the caller's org before inserting, and the RLS
-- policies on `findings` and `risks` make a cross-tenant id unresolvable in
-- the first place. Defence in depth, all three layers asserted by tests.
ALTER TABLE finding_risks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finding_risks_tenant_isolation ON finding_risks;
CREATE POLICY finding_risks_tenant_isolation ON finding_risks
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON finding_risks TO app_request;

COMMENT ON TABLE finding_risks IS
  'Many-to-many between findings and Risk Register entries. A finding with no row here is STANDALONE, which is the default and is never changed automatically. link_type distinguishes attaching to an existing risk from promoting a finding into a new one; both are human acts. Link/unlink/promotion history lives in security_audit_log.';

COMMENT ON COLUMN finding_risks.link_type IS
  '''linked'' = a person attached this finding to an existing risk. ''promoted'' = a person created this risk from this finding. Never written by automation.';
