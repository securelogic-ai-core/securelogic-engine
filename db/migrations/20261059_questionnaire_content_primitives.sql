-- 20261059_questionnaire_content_primitives.sql
--
-- VA-Q1 / P1 — the question entity. ADR-0013 R1 (questions are content;
-- requirements are canon) and R3 (issued content is immutable).
--
-- Three tables, none of which anything reads yet. This migration is
-- deliberately invisible to every customer: the portal, the resolver and the
-- reviewer surfaces keep rendering `requirements` until P2 addresses them by
-- version, and P3 bridges the existing content across. Landing the primitives
-- alone first is what lets each later step be a small, reviewable diff.
--
--   questions                   the addressable identity of a vendor-facing
--                               question. Org-scoped. Mutable ONLY in status.
--   question_versions           the content. IMMUTABLE — a BEFORE UPDATE OR
--                               DELETE trigger raises. Editing a question means
--                               publishing version N+1; every issued
--                               questionnaire that referenced N keeps N. This
--                               is the row an issued snapshot is addressed by,
--                               so it must never move under a vendor's answer.
--   question_requirement_links  many-to-many lineage to the canonical
--                               requirement library (and through it to the
--                               framework and, later, the domain). Requirements
--                               carry no organization_id — they inherit scope
--                               through their framework — so the org check on a
--                               link is enforced in code with a framework join,
--                               and asserted by the isolation suite.
--
-- content_hash is computed in application code (questionContent.ts) over the
-- canonical JSON of {prompt, guidance, answer_type, options, evidence_policy}.
-- The database checks only its shape; the hash logic lives in exactly one
-- place so the P2 snapshot hash and the P3 equivalence proof cannot disagree
-- with the row.

CREATE TABLE IF NOT EXISTS questions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question_key         TEXT        NOT NULL,
  domain               TEXT        NOT NULL
                         CHECK (domain IN ('security', 'privacy', 'ai', 'resilience', 'nth_party', 'compliance')),
  origin               TEXT        NOT NULL
                         CHECK (origin IN ('securelogic', 'customer')),
  template_key         TEXT        NULL,
  status               TEXT        NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'active', 'retired')),
  current_version      INTEGER     NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  created_by_user_id   UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT questions_key_shape CHECK (question_key ~ '^[a-z0-9][a-z0-9._:-]{1,199}$'),
  CONSTRAINT questions_org_key_unique UNIQUE (organization_id, question_key),
  -- A question is only 'active' once it has published content.
  CONSTRAINT questions_active_has_version CHECK (status <> 'active' OR current_version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_questions_org_status ON questions (organization_id, status);

CREATE TABLE IF NOT EXISTS question_versions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question_id           UUID        NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  version               INTEGER     NOT NULL CHECK (version >= 1),
  prompt                TEXT        NOT NULL CHECK (length(trim(prompt)) BETWEEN 1 AND 2000),
  guidance              TEXT        NULL CHECK (guidance IS NULL OR length(guidance) <= 8000),
  answer_type           TEXT        NOT NULL
                          CHECK (answer_type IN ('attest', 'select_one', 'select_many', 'text', 'numeric', 'date')),
  options               JSONB       NULL,
  evidence_policy       TEXT        NOT NULL DEFAULT 'optional'
                          CHECK (evidence_policy IN ('none', 'optional', 'required_on_pass', 'required_always')),
  content_hash          TEXT        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  published_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by_user_id  UUID        NULL REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT question_versions_unique UNIQUE (question_id, version),
  -- select_* answers need a closed option list; nothing else may carry one.
  CONSTRAINT question_versions_options_shape CHECK (
    (answer_type IN ('select_one', 'select_many') AND jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2)
    OR (answer_type NOT IN ('select_one', 'select_many') AND options IS NULL)
  )
);

-- The same content published twice under one question is a no-op, not a new
-- version: the hash is unique per question. It is NOT unique per org — two
-- different questions may legitimately share text during a bridge/curation
-- overlap, and identity is the question_key, not the words.
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_versions_question_hash
  ON question_versions (question_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_question_versions_org ON question_versions (organization_id);

-- IMMUTABLE. The one rule ADR-0013 R3 rests on. Deletion is refused too: a
-- version an issued snapshot points at must outlive the library edit that
-- superseded it. Retiring a question is a status change on `questions`.
--
-- Enforced by the platform's ONE append-only guard (worm_guard_mutation,
-- 20261018), not a private copy — wormGuardConsolidation.test.ts fails the
-- build on any table that brings its own. That guard also carries the single
-- sanctioned escape hatch: a certified, org-scoped erasure (ADR-0005), which is
-- exactly the "immutable within the tenant's lifetime" semantics VA-Q0 T-14
-- documents. UPDATE is refused as well as DELETE — content-addressed rows
-- cannot be edited in place.
DROP TRIGGER IF EXISTS trg_question_versions_immutable ON question_versions;
CREATE TRIGGER trg_question_versions_immutable
  BEFORE UPDATE OR DELETE ON question_versions
  FOR EACH ROW EXECUTE FUNCTION worm_guard_mutation('immutable (ADR-0013 R3)', 'is not permitted', ' — publish a new version instead');
DROP TRIGGER IF EXISTS trg_question_versions_no_truncate ON question_versions;
CREATE TRIGGER trg_question_versions_no_truncate
  BEFORE TRUNCATE ON question_versions
  FOR EACH STATEMENT EXECUTE FUNCTION worm_guard_mutation('immutable (ADR-0013 R3)', 'is not permitted', ' — publish a new version instead');

CREATE TABLE IF NOT EXISTS question_requirement_links (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question_id          UUID        NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  requirement_id       UUID        NOT NULL REFERENCES requirements(id) ON DELETE RESTRICT,
  relation             TEXT        NOT NULL DEFAULT 'evidences'
                         CHECK (relation IN ('evidences', 'partially_evidences')),
  created_by_user_id   UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT question_requirement_links_unique UNIQUE (question_id, requirement_id)
);

CREATE INDEX IF NOT EXISTS idx_question_requirement_links_requirement
  ON question_requirement_links (organization_id, requirement_id);

-- ── Tenant isolation ────────────────────────────────────────────────────────
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS questions_tenant_isolation ON questions;
CREATE POLICY questions_tenant_isolation ON questions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE question_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS question_versions_tenant_isolation ON question_versions;
CREATE POLICY question_versions_tenant_isolation ON question_versions
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE question_requirement_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS question_requirement_links_tenant_isolation ON question_requirement_links;
CREATE POLICY question_requirement_links_tenant_isolation ON question_requirement_links
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- app_request never needs UPDATE or DELETE on versions: the trigger refuses
-- both anyway, and withholding the grant makes an attempt fail as
-- permission-denied before the trigger even runs — two independent walls.
GRANT SELECT, INSERT, UPDATE, DELETE ON questions                  TO app_request;
GRANT SELECT, INSERT                 ON question_versions          TO app_request;
GRANT SELECT, INSERT, DELETE         ON question_requirement_links TO app_request;
