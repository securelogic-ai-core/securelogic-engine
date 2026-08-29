-- Migration: assessment_facts
-- Package:   VA-Q2 P3 — canonical polymorphic fact store (slot 20261063)
--
-- Ledger re-checked the day this file was created (2026-08-29): db/migrations
-- topped at 20261062 (P2, PR #914); no remote branch and no commit on any
-- branch claimed 2026106[3-9].
--
-- ── What this is ────────────────────────────────────────────────────────────
--
-- THE ONE canonical fact object (CANONICAL_DOMAIN_MODEL.md "Assessment Fact";
-- owner decision D1 = Option B, 2026-08-28). A declared fact about a canonical
-- SUBJECT — (organization_id, subject_type, subject_id, fact_key) — with an
-- immutable value, two provenance axes, timing, confidence and status:
--
--   source  TRUST CLASS — who asserted it (owner's five: intake,
--           vendor_response, ai_extraction, internal_user, system_derived).
--           The authority rules are stated over this axis.
--   origin  MECHANISM — how it reached the store (VA-Q0 §6.1's six: intake,
--           vendor_profile, ai_system_dependency, vendor_answer,
--           profile_default, derived). Precedence is ranked over this axis.
--           The two are different questions; the allowed pairs are a CHECK.
--
-- Q2 writes exactly one subject type (vendor_engagement). This is NOT an
-- unconstrained generic polymorphic table: subject_type is a CLOSED allowlist
-- (CHECK here, enum in factSubjects.ts, lockstep-tested from pg_constraint),
-- and vendor / ai_system / asset / organization are RESERVED — each enters
-- only with its own migration widening the CHECK, its resolver arm and tests.
--
-- ── Integrity without an FK (polymorphic subject_id) — three layers ─────────
--
--   1. RLS by organization_id, the platform shape (ENABLE, not FORCE — see below).
--   2. Trigger assessment_facts_check_subject() BEFORE INSERT OR UPDATE OF the
--      subject/org columns: a per-type CASE arm loads the subject
--      WHERE id AND organization_id and raises 23503 otherwise; the ELSE arm
--      refuses an unknown type behind the CHECK. Also asserts supersedes_id
--      names a row of the same (org, subject, fact_key). Runs as the invoker,
--      so under RLS an org-B subject is simply NOT FOUND — the same answer as
--      non-existence (no oracle).
--   3. Code: SUBJECT_RESOLVERS[subject_type] in factSubjects.ts — the only way
--      a route obtains a subject; runs inside asTenant and compares
--      organization_id.
--
-- ── Values are immutable; history is the supersede chain ────────────────────
--
-- `value` is never UPDATEd. A new value inserts a new `accepted` row with
-- supersedes_id → the prior row, whose status flips to `superseded` in the
-- same transaction. The BEFORE UPDATE trigger is a state machine (the
-- finding_risk_acceptances_enforce_worm precedent): value/provenance/subject
-- columns are frozen; the only legal status moves are
-- proposed→accepted (with accepted_at + accepted_by_user_id — the governed
-- human boundary), proposed→rejected, accepted→superseded. An ai_extraction
-- row is BORN proposed (insert with any other status is refused) and can reach
-- accepted only through that boundary. Nothing is deleted: app_request has
-- SELECT, INSERT, UPDATE and NO DELETE. There is deliberately no DELETE or
-- TRUNCATE trigger (the WORM-consolidation lint inspects those; this table is
-- not one of its nine).
--
-- ── Idempotency ─────────────────────────────────────────────────────────────
--
-- One LIVE row per distinct assertion: UNIQUE over (org, subject, fact_key,
-- value_hash, source, origin) WHERE status IN ('proposed','accepted'). The
-- plan's key was unconditional; it is made partial here because an
-- unconditional key makes A→B→A impossible (the third assertion would collide
-- with the superseded first row and silently leave B current). Re-asserting
-- the same live value is a no-op by the writer's read-then-insert under a
-- per-subject transaction advisory lock. One ACCEPTED value per
-- (org, subject, fact_key, source, origin) is a second partial unique.
--
-- Rollback: docs/release/ROLLBACK-20261063.sql (drop triggers, functions,
-- table). Code rollback (redeploy the previous SHA) is sufficient on its own:
-- no read path outside this package requires the table.

CREATE TABLE IF NOT EXISTS assessment_facts (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- CLOSED allowlist. Widened ONLY by a later migration that also ships the
  -- subject's resolver arm + trigger arm + tests. RESERVED, NOT accepted here:
  -- 'vendor', 'ai_system', 'asset', 'organization'.
  subject_type         TEXT         NOT NULL
                         CONSTRAINT assessment_facts_subject_type_check
                         CHECK (subject_type IN ('vendor_engagement')),
  subject_id           UUID         NOT NULL,   -- polymorphic; integrity via trigger + resolver + RLS

  -- Registry membership + type are enforced in code (validateFact); the DB
  -- checks the shape only.
  fact_key             TEXT         NOT NULL
                         CONSTRAINT assessment_facts_fact_key_check
                         CHECK (fact_key ~ '^[a-z]+(\.[a-z_]+)+$'),
  value                JSONB        NOT NULL,
  value_hash           TEXT         NOT NULL
                         CONSTRAINT assessment_facts_value_hash_check
                         CHECK (value_hash ~ '^[0-9a-f]{64}$'),

  source               TEXT         NOT NULL
                         CONSTRAINT assessment_facts_source_check
                         CHECK (source IN ('intake', 'vendor_response', 'ai_extraction', 'internal_user', 'system_derived')),
  origin               TEXT         NOT NULL
                         CONSTRAINT assessment_facts_origin_check
                         CHECK (origin IN ('intake', 'vendor_profile', 'ai_system_dependency', 'vendor_answer', 'profile_default', 'derived')),
  -- Allowed (source, origin) pairs — mirrored by ALLOWED_SOURCE_ORIGIN_PAIRS.
  CONSTRAINT assessment_facts_source_origin_check CHECK (
       (source = 'intake'          AND origin = 'intake')
    OR (source = 'internal_user'   AND origin = 'intake')
    OR (source = 'system_derived'  AND origin IN ('vendor_profile', 'ai_system_dependency', 'profile_default', 'derived'))
    OR (source = 'vendor_response' AND origin = 'vendor_answer')
    OR (source = 'ai_extraction'   AND origin = 'derived')
  ),

  -- { actor: {kind:'user'|'system'|'vendor_participant'|'model', id}, via: route|job|worker,
  --   at: ISO-8601, evidence: {table, id} | null, model: {model_id,prompt_version,input_hash} | null }
  provenance           JSONB        NOT NULL,
  CONSTRAINT assessment_facts_provenance_check CHECK (
    jsonb_typeof(provenance) = 'object'
    AND provenance ? 'actor' AND provenance ? 'via' AND provenance ? 'at'
  ),

  observed_at          TIMESTAMPTZ  NOT NULL,   -- when the fact was true/observed (validated <= now() in code)
  -- Internal verification ONLY. A vendor or a model can never verify.
  verified_at          TIMESTAMPTZ  NULL,
  CONSTRAINT assessment_facts_verified_by_internal_check CHECK (
    verified_at IS NULL OR source IN ('intake', 'internal_user')
  ),
  confidence           NUMERIC(4,3) NOT NULL DEFAULT 1.000
                         CONSTRAINT assessment_facts_confidence_check
                         CHECK (confidence >= 0 AND confidence <= 1),

  status               TEXT         NOT NULL DEFAULT 'accepted'
                         CONSTRAINT assessment_facts_status_check
                         CHECK (status IN ('proposed', 'accepted', 'superseded', 'rejected')),
  -- The governed human-accept boundary for a proposed row (ai_extraction).
  accepted_at          TIMESTAMPTZ  NULL,
  accepted_by_user_id  UUID         NULL REFERENCES users(id) ON DELETE SET NULL,

  supersedes_id        UUID         NULL REFERENCES assessment_facts(id),   -- same org/subject/fact_key (trigger-checked)
  created_by           UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Idempotency: one LIVE row per distinct assertion (see header for why partial).
CREATE UNIQUE INDEX IF NOT EXISTS assessment_facts_live_assertion_unique
  ON assessment_facts (organization_id, subject_type, subject_id, fact_key, value_hash, source, origin)
  WHERE status IN ('proposed', 'accepted');

-- At most one ACCEPTED current value per (subject, fact_key, source, origin).
CREATE UNIQUE INDEX IF NOT EXISTS assessment_facts_one_accepted_unique
  ON assessment_facts (organization_id, subject_type, subject_id, fact_key, source, origin)
  WHERE status = 'accepted';

-- Subject lookup (the resolver's read).
CREATE INDEX IF NOT EXISTS idx_assessment_facts_subject
  ON assessment_facts (organization_id, subject_type, subject_id);

-- Cross-subject fact query (posture / monitoring).
CREATE INDEX IF NOT EXISTS idx_assessment_facts_org_key
  ON assessment_facts (organization_id, fact_key);

-- Hot path: accepted facts of one subject.
CREATE INDEX IF NOT EXISTS idx_assessment_facts_subject_accepted
  ON assessment_facts (organization_id, subject_type, subject_id, fact_key)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS idx_assessment_facts_supersedes
  ON assessment_facts (supersedes_id)
  WHERE supersedes_id IS NOT NULL;

-- ---------------------------------------------------------------
-- Trigger 1: subject existence + same-org, per type (layer 2 of 3)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION assessment_facts_check_subject()
RETURNS TRIGGER AS $$
DECLARE
  found_subject BOOLEAN := FALSE;
  prior RECORD;
BEGIN
  CASE NEW.subject_type
    WHEN 'vendor_engagement' THEN
      SELECT TRUE INTO found_subject
        FROM vendor_engagements
       WHERE id = NEW.subject_id AND organization_id = NEW.organization_id
       LIMIT 1;
    ELSE
      -- Defence in depth behind the CHECK: an arm nobody wrote is not a subject.
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = format('assessment_facts: subject_type %s has no resolver arm', NEW.subject_type);
  END CASE;

  IF NOT COALESCE(found_subject, FALSE) THEN
    -- The same message for "does not exist" and "belongs to another org":
    -- under RLS the trigger cannot tell them apart, and must not.
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'assessment_facts: subject does not exist in this organization';
  END IF;

  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT organization_id, subject_type, subject_id, fact_key INTO prior
      FROM assessment_facts WHERE id = NEW.supersedes_id;
    IF NOT FOUND
       OR prior.organization_id <> NEW.organization_id
       OR prior.subject_type    <> NEW.subject_type
       OR prior.subject_id      <> NEW.subject_id
       OR prior.fact_key        <> NEW.fact_key THEN
      RAISE EXCEPTION USING ERRCODE = '23503',
        MESSAGE = 'assessment_facts: supersedes_id must name a fact of the same subject and fact_key in this organization';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assessment_facts_check_subject ON assessment_facts;
CREATE TRIGGER assessment_facts_check_subject
  BEFORE INSERT OR UPDATE OF subject_type, subject_id, organization_id, supersedes_id
  ON assessment_facts
  FOR EACH ROW EXECUTE FUNCTION assessment_facts_check_subject();

-- ---------------------------------------------------------------
-- Trigger 2: immutable values, status state machine, AI born proposed
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION assessment_facts_enforce_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('proposed', 'accepted') THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = format('assessment_facts: a fact is born proposed or accepted, not %s', NEW.status);
    END IF;
    -- AI-derived information is never authoritative without the human boundary.
    IF NEW.source = 'ai_extraction' AND NEW.status <> 'proposed' THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'assessment_facts: an ai_extraction fact is born proposed; it becomes accepted only through the human-accept boundary';
    END IF;
    IF NEW.accepted_at IS NOT NULL OR NEW.accepted_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'assessment_facts: accepted_at/accepted_by_user_id are set only by the proposed→accepted transition';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: the assertion itself is immutable.
  IF NEW.id              <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.subject_type    <> OLD.subject_type
     OR NEW.subject_id      <> OLD.subject_id
     OR NEW.fact_key        <> OLD.fact_key
     OR NEW.value           <> OLD.value
     OR NEW.value_hash      <> OLD.value_hash
     OR NEW.source          <> OLD.source
     OR NEW.origin          <> OLD.origin
     OR NEW.provenance      <> OLD.provenance
     OR NEW.observed_at     <> OLD.observed_at
     OR NEW.confidence      <> OLD.confidence
     OR NEW.supersedes_id   IS DISTINCT FROM OLD.supersedes_id
     OR NEW.created_by      IS DISTINCT FROM OLD.created_by
     OR NEW.created_at      <> OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'assessment_facts: a fact''s value, subject, provenance and timing are immutable — insert a superseding row';
  END IF;

  -- verified_at: set once, by internal verification only (CHECK covers the source); never cleared.
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at AND OLD.verified_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'assessment_facts: verified_at cannot be changed once set';
  END IF;

  -- Legal status transitions only.
  IF NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'proposed' AND NEW.status IN ('accepted', 'rejected'))
      OR (OLD.status = 'accepted' AND NEW.status = 'superseded')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = format('assessment_facts: illegal status transition %s → %s', OLD.status, NEW.status);
    END IF;
    -- The governed human-accept boundary: a proposal is accepted by a named human, now.
    IF OLD.status = 'proposed' AND NEW.status = 'accepted'
       AND (NEW.accepted_at IS NULL OR NEW.accepted_by_user_id IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'assessment_facts: proposed → accepted requires accepted_at and accepted_by_user_id (the human-accept boundary)';
    END IF;
  END IF;

  -- accepted_at / accepted_by_user_id move only with that transition.
  IF (NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id)
     AND NOT (OLD.status = 'proposed' AND NEW.status = 'accepted') THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'assessment_facts: accepted_at/accepted_by_user_id are set only by the proposed→accepted transition';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assessment_facts_enforce_immutability ON assessment_facts;
CREATE TRIGGER assessment_facts_enforce_immutability
  BEFORE INSERT OR UPDATE ON assessment_facts
  FOR EACH ROW EXECUTE FUNCTION assessment_facts_enforce_immutability();

-- ---------------------------------------------------------------
-- RLS (layer 1 of 3) + grants
-- ---------------------------------------------------------------
ALTER TABLE assessment_facts ENABLE ROW LEVEL SECURITY;
-- NOT FORCE — the platform standard (20260619/20260620, TENANT_ISOLATION_STANDARD
-- census: 0 FORCE). The owner / elevated channel (pgElevated, migrations,
-- tenant erasure, export) must keep bypassing RLS for its legitimate cross-org
-- work; the request path is app_request, which RLS binds.
DROP POLICY IF EXISTS assessment_facts_tenant_isolation ON assessment_facts;
CREATE POLICY assessment_facts_tenant_isolation ON assessment_facts
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- No DELETE: values are immutable history. UPDATE is required for the
-- status machine (accepted → superseded, proposed → accepted/rejected).
GRANT SELECT, INSERT, UPDATE ON assessment_facts TO app_request;

COMMENT ON TABLE assessment_facts IS
  'THE canonical polymorphic fact store (VA-Q2 P3, D1 Option B). A fact about a '
  'canonical subject (subject_type + subject_id — CLOSED allowlist, Q2: vendor_engagement) '
  'owned by one organization. `source` = trust class (who asserted), `origin` = mechanism '
  '(how; precedence ranks over it). Values are immutable: a new value is a new accepted row '
  'with supersedes_id; the prior row becomes superseded. ai_extraction rows are born '
  'proposed and reach accepted only through the human-accept boundary. The scope resolver '
  'reads accepted rows only. No FK on subject_id: RLS + subject trigger + code resolver.';
