-- 20261081 — ADR-0012 Step 2, part 2 of 3. evidence_links: where an artifact
-- COUNTS, and the per-use confirmation that makes it count.
--
-- Re-slotted from the ADR's reserved 20261052; see 20261080's header for the
-- full re-slotting record. 20261051–55 are retired unused.
--
-- ── THE MOVE ───────────────────────────────────────────────────────────────
--
-- evidence.source_type/source_id freeze as WHERE THE ARTIFACT CAME FROM (the
-- 20260928 pointer-type rule). This table records WHERE IT COUNTS. One artifact,
-- one blob, one evidence_analysis row — N uses. Today re-attaching the same SOC 2
-- to a second engagement means a second upload, a second blob, a second LLM
-- analysis and a second review, with the quota charged twice.
--
-- ── PER-USE CONFIRMATION IS THE WHOLE CONTROL ──────────────────────────────
--
-- A link COUNTS only when a human confirmed THAT link in THAT context.
-- Attaching never counts by itself, and a confirmation made in one context
-- never leaks into another. This is the machines-observe-humans-decide stance
-- the effectiveness ladder already takes: evidence_analysis is advisory input
-- shown at confirmation time, never the confirmation. A machine-created link
-- must not be able to promote an engagement to `evidenced` on someone else's
-- judgement, so confirmation structurally requires an attributed human.
--
-- ── NO WRITER SHIPS IN THIS PACKAGE, AND THAT IS DELIBERATE ────────────────
--
-- Nothing in the application writes this table yet: no route, no worker, no
-- backfill. Stated here because this repository has been bitten by the opposite
-- omission — VA-S4 Step 4 shipped an opinion vocabulary, a coverage gate and an
-- authority CHECK with NO WRITER, and the gap was found only much later. This
-- one is declared at birth: the governed writer (link / confirm / detach /
-- supersede, each durably audited) is the NEXT package, and until it exists
-- this table is empty by construction and every counting surface still reads
-- exactly what it read before.
--
-- CONSEQUENCE OF ON DELETE RESTRICT, stated so it is not discovered in prod:
-- once a link exists for an evidence row, `DELETE FROM evidence` for that row is
-- refused. There is such a DELETE today on the vendor-portal path
-- (vendorPortal.ts). It cannot break while this table is empty, and the writer
-- package must convert that path to a detach before it can create links.
-- Deleting evidence somebody relied on is precisely what ADR-0012's standing
-- rule forbids: correction happens through supersession, never destruction.
--
-- Reversible: docs/release/ROLLBACK-20261081.sql.

CREATE TABLE IF NOT EXISTS evidence_links (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- RESTRICT: an artifact in use cannot be deleted out from under the decision
  -- that relied on it.
  evidence_id           UUID        NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,

  -- WHERE it counts. Polymorphic by design (§7.3 accepts the no-FK tradeoff,
  -- the same one findings.source_id carries); route-level target verification
  -- is the guard the writer package owes.
  target_type           TEXT        NOT NULL,
  target_id             UUID        NOT NULL,

  -- The engagement x requirement grain, which is the grain the effectiveness
  -- ladder actually counts at today (idx_evidence_engagement_requirement, 20260927).
  -- ADR-0012 §2.1's column list has target_type/target_id only; a link table
  -- that cannot address the platform's principal evidence grain would be
  -- unusable substrate, so the existing grain is expressed rather than invented.
  -- Legal ONLY beside target_type='vendor_engagement' (constraint below).
  -- RESTRICT, not SET NULL: silently widening a requirement-scoped proof into an
  -- engagement-wide one would make evidence claim more than a human confirmed.
  target_requirement_id UUID        NULL REFERENCES requirements(id) ON DELETE RESTRICT,

  link_kind             TEXT        NOT NULL,

  linked_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  linked_by_user_id     UUID        NULL REFERENCES users(id) ON DELETE SET NULL,

  -- Per-use confirmation. All-or-none, write-once (trigger below).
  confirmed_at          TIMESTAMPTZ NULL,
  confirmed_by_user_id  UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  confirmation_note     TEXT        NULL,

  -- Detach is how a link ends. There is no DELETE.
  detached_at           TIMESTAMPTZ NULL,
  detached_by_user_id   UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  detach_reason         TEXT        NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Consumer contexts ONLY. Each value below names a table verified to exist in
  -- this schema. Deliberately NOT a copy of evidence.source_type: that column
  -- answers "which workflow produced this artifact", a different question, and
  -- conflating the two axes is the dual-truth risk ADR-0012 §7.1 accepts and
  -- asks to be made detectable. Widening this list later is a safe migration;
  -- shipping a value with no verified target is not.
  CONSTRAINT evidence_links_target_type_check CHECK (
    target_type IN (
      'finding',                -- findings          — the closure gate
      'vendor_engagement',      -- vendor_engagements — the effectiveness ladder
      'governance_review',      -- governance_reviews — AI governance
      'control_assessment',     -- control_assessments
      'obligation_assessment',  -- obligation_assessments
      'asset_assessment'        -- asset_assessments
    )
  ),

  CONSTRAINT evidence_links_requirement_grain_check CHECK (
    target_requirement_id IS NULL OR target_type = 'vendor_engagement'
  ),

  CONSTRAINT evidence_links_kind_check CHECK (
    link_kind IN ('origin', 'reuse')
  ),

  -- A confirmation is a human act or it did not happen. The note is required
  -- with it: "somebody checked" without saying what they checked is the state
  -- the ladder already cannot distinguish from "somebody clicked".
  CONSTRAINT evidence_links_confirmation_all_or_none CHECK (
    (confirmed_at IS NULL AND confirmed_by_user_id IS NULL AND confirmation_note IS NULL)
    OR
    (confirmed_at IS NOT NULL
       AND confirmed_by_user_id IS NOT NULL
       AND confirmation_note IS NOT NULL
       AND length(trim(confirmation_note)) > 0)
  ),

  CONSTRAINT evidence_links_detach_all_or_none CHECK (
    (detached_at IS NULL AND detached_by_user_id IS NULL AND detach_reason IS NULL)
    OR
    (detached_at IS NOT NULL AND detached_by_user_id IS NOT NULL AND detach_reason IS NOT NULL)
  ),

  CONSTRAINT evidence_links_detach_reason_check CHECK (
    detach_reason IS NULL
    OR detach_reason IN ('superseded', 'incorrect_attachment', 'no_longer_relevant', 'withdrawn')
  )
);

-- One LIVE link per (org, artifact, target, requirement grain). Detached links
-- accumulate beside it — the history of what was relied on stays readable.
-- COALESCE keeps the engagement-wide link and the per-requirement links distinct
-- rather than colliding on a NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_links_live
  ON evidence_links (organization_id, evidence_id, target_type, target_id,
                     COALESCE(target_requirement_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE detached_at IS NULL;

-- The counting join: "which live confirmed links does this target have".
CREATE INDEX IF NOT EXISTS idx_evidence_links_target
  ON evidence_links (organization_id, target_type, target_id)
  WHERE detached_at IS NULL;

-- The reuse view: "where else does this artifact count".
CREATE INDEX IF NOT EXISTS idx_evidence_links_evidence
  ON evidence_links (evidence_id)
  WHERE detached_at IS NULL;

-- ---------------------------------------------------------------
-- Immutability + write-once, enforced at the row
-- ---------------------------------------------------------------
--
-- BEFORE UPDATE only. This trigger deliberately never mentions DELETE or
-- TRUNCATE: no DELETE grant exists (below), and wormGuardConsolidation.test.ts
-- requires every delete/truncate trigger in the database to resolve to the
-- shared worm_guard_mutation. One policy, one place.

CREATE OR REPLACE FUNCTION evidence_link_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Identity is frozen. A link that can be repointed is not a record of what
  -- was relied upon.
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.evidence_id IS DISTINCT FROM OLD.evidence_id
     OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.target_id IS DISTINCT FROM OLD.target_id
     OR NEW.target_requirement_id IS DISTINCT FROM OLD.target_requirement_id
     OR NEW.link_kind IS DISTINCT FROM OLD.link_kind
     OR NEW.linked_at IS DISTINCT FROM OLD.linked_at
     OR NEW.linked_by_user_id IS DISTINCT FROM OLD.linked_by_user_id THEN
    RAISE EXCEPTION
      'evidence_links identity is immutable: link % cannot be repointed', OLD.id
      USING ERRCODE = '23514',
            HINT = 'Detach this link and create a new one. ADR-0012: correction '
                   'is supersession, never destructive mutation.';
  END IF;

  -- Confirmation is write-once. Re-confirming, un-confirming or rewriting the
  -- note would change what a past decision rested on.
  IF OLD.confirmed_at IS NOT NULL
     AND (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
          OR NEW.confirmed_by_user_id IS DISTINCT FROM OLD.confirmed_by_user_id
          OR NEW.confirmation_note IS DISTINCT FROM OLD.confirmation_note) THEN
    RAISE EXCEPTION
      'evidence_links confirmation is write-once: link % is already confirmed', OLD.id
      USING ERRCODE = '23514',
            HINT = 'A confirmation records a judgement made at a moment. Detach '
                   'and relink to record a new one.';
  END IF;

  -- Detach is terminal.
  IF OLD.detached_at IS NOT NULL THEN
    RAISE EXCEPTION
      'evidence_links row % is detached and cannot be modified', OLD.id
      USING ERRCODE = '23514',
            HINT = 'Create a new link instead of reviving a detached one.';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evidence_link_guard_update ON evidence_links;
CREATE TRIGGER trg_evidence_link_guard_update
  BEFORE UPDATE ON evidence_links
  FOR EACH ROW EXECUTE FUNCTION evidence_link_guard_update();

-- The link and the artifact it points at must belong to the same tenant. RLS
-- stops the READ; a foreign key is not org-aware, so the write side is enforced
-- here. INSERT/UPDATE only, for the same reason as above.
CREATE OR REPLACE FUNCTION evidence_link_same_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  artifact_org UUID;
BEGIN
  SELECT organization_id INTO artifact_org FROM evidence WHERE id = NEW.evidence_id;

  IF artifact_org IS NULL OR artifact_org <> NEW.organization_id THEN
    RAISE EXCEPTION
      'evidence_link % would link organization % to evidence owned by %',
      NEW.id, NEW.organization_id, COALESCE(artifact_org::text, 'nothing')
      USING ERRCODE = '23514',
            HINT = 'Evidence reuse is tenant-local. Linking across organisations '
                   'would import another tenant''s proof into your posture.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evidence_link_same_org ON evidence_links;
CREATE TRIGGER trg_evidence_link_same_org
  BEFORE INSERT OR UPDATE ON evidence_links
  FOR EACH ROW EXECUTE FUNCTION evidence_link_same_org();

-- ---------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------

ALTER TABLE evidence_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evidence_links_tenant_isolation ON evidence_links;
CREATE POLICY evidence_links_tenant_isolation ON evidence_links
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Column-limited UPDATE and NO DELETE, per ADR-0012 §2.1. A link is created,
-- confirmed once, and detached — the privilege set says so, so a future writer
-- cannot quietly acquire the ability to rewrite history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_request') THEN
    GRANT SELECT, INSERT ON evidence_links TO app_request;
    GRANT UPDATE (confirmed_at, confirmed_by_user_id, confirmation_note,
                  detached_at, detached_by_user_id, detach_reason, updated_at)
      ON evidence_links TO app_request;
  END IF;
END
$$;

COMMENT ON TABLE evidence_links IS
  'ADR-0012 Step 2. WHERE an evidence artifact COUNTS, as distinct from where it '
  'came from (evidence.source_type/source_id). Append-and-detach: no DELETE grant '
  'exists. A link counts only when a human confirmed THAT link in THAT context — '
  'confirmation never leaks between contexts. Empty by construction on the day it '
  'ships: no route, worker or backfill writes it, and no legacy origin link was '
  'fabricated (owner direction 2026-09-01). Absence of a link is absence of a '
  'confirmed use, never a gap to be filled by inference.';

COMMENT ON COLUMN evidence_links.confirmed_at IS
  'When a human confirmed this artifact supports the claim IN THIS CONTEXT. '
  'Write-once (trigger). evidence_analysis is advisory input at this moment, '
  'never a substitute for it: a model verdict must not promote an engagement.';

COMMENT ON COLUMN evidence_links.target_requirement_id IS
  'The requirement grain within a vendor engagement — the grain the effectiveness '
  'ladder counts at today. NULL means the link is engagement-wide. ON DELETE '
  'RESTRICT so a requirement carrying confirmed evidence cannot vanish and '
  'silently widen what that evidence proves.';
