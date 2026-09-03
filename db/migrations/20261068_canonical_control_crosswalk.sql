-- Migration: canonical_control_crosswalk (+ the versioned global requirement identity)
-- Package:   VA-S4 Step 1 — canonical control identity foundation (slot 20261068)
-- Docs:      docs/design/VA-CANONICAL-CONTROL-IDENTITY-reconciliation.md §4.1(b)
--
-- Owner ruling, 2026-08-30: because requirements are TENANT-SCOPED, the global
-- crosswalk must not FK to `requirements.id`. The global requirement identity
-- is approved on the stable reference identity
--
--     (framework_key, framework_version, requirement_reference)
--
-- "provided repository inspection confirms these fields uniquely and
-- deterministically identify the versioned requirement. Add appropriate
-- uniqueness/integrity enforcement."
--
-- ── The inspection, and what it found ──────────────────────────────────────
--
-- It does NOT hold today, and this migration is what makes it hold.
--
--   * `requirements` is UNIQUE (framework_id, reference_id) — so a reference is
--     unique WITHIN a framework row. Good.
--   * `frameworks` is UNIQUE (organization_id, name, version) — and `name` is a
--     free-text, user-editable DISPLAY string. There is NO framework key
--     anywhere in the schema.
--   * Two stable key vocabularies exist in CODE and are never persisted:
--     `FRAMEWORK_TEMPLATES` keys (soc2, nist_csf, …), used by the activation
--     route, and `FRAMEWORK_REFS` keys (nist-csf-2.0, soc2, …), used by
--     templateLoader. Both resolve to (name, version) on the way into the DB
--     and are discarded there.
--
-- So a global crosswalk keyed on (framework_key, framework_version, reference)
-- could not be joined back to a tenant requirement at all. Three things fix it:
--
--   1. `canonical_framework_versions` — the registry that makes a
--      (framework_key, framework_version) pair a real, enumerable identity
--      rather than free text, with UNIQUE (display_name, framework_version) so
--      the reverse resolution from a tenant `frameworks` row is DETERMINISTIC.
--   2. `frameworks.framework_key` — persisted at activation and backfilled
--      here, nullable because a customer-authored framework legitimately has no
--      canonical identity (the same positive-absence principle the tenant
--      control side uses in 20261069).
--   3. a composite FK from `frameworks` into the registry, so a non-null key
--      cannot name a framework version that does not exist.
--
-- ── Governed publication: AI may propose, it may not publish ───────────────
--
-- A CHECK, not a convention — the same boundary
-- `vendor_assurance_cuec_control_mappings` draws with mapping_status /
-- mapping_source, and the same one 20261066 draws for an accepted opinion:
-- nothing reaches `approved` or `published` without naming a human approver.
--
-- ── Versioning and historical reconstruction ───────────────────────────────
--
-- A framework version bump produces NEW crosswalk rows against the new
-- (framework_key, framework_version); the old rows stay addressable and are
-- retired by `superseded_at`, never deleted or repointed. This is the exact
-- failure the reconciliation found in `control_mappings`, which has no version,
-- no effective dates, no supersession, and is hard-DELETEd by frameworks.ts.
--
-- `control_mappings` is NOT changed by this migration. It remains the
-- tenant-resolved view; materialising tenant mappings from published crosswalk
-- rows is a separate, later step, per the owner ruling.
--
-- ADDITIVE. One nullable column and one FK on `frameworks`; the backfill only
-- writes rows where framework_key IS NULL and a registry row matches exactly.
-- Rollback: docs/release/ROLLBACK-20261068.sql
-- Idempotent and re-runnable.

-- ---------------------------------------------------------------
-- 1. canonical_framework_versions — the versioned global framework identity
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_framework_versions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable, lower-kebab, version-free. 'nist-csf', never 'nist-csf-2.0':
  -- the version is its own column so a bump is a new row, not a new framework.
  framework_key      TEXT        NOT NULL,
  framework_version  TEXT        NOT NULL,

  -- The display name a tenant `frameworks` row carries for this identity. This
  -- is what makes the reverse resolution deterministic, and it is why the
  -- (display_name, framework_version) UNIQUE below is load-bearing rather than
  -- decorative.
  display_name       TEXT        NOT NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_framework_versions_identity_unique
    UNIQUE (framework_key, framework_version),

  -- Deterministic reverse resolution: a tenant (name, version) resolves to at
  -- most ONE canonical framework identity. Without this the backfill below
  -- could silently pick one of several.
  CONSTRAINT canonical_framework_versions_display_unique
    UNIQUE (display_name, framework_version),

  CONSTRAINT canonical_framework_versions_key_grammar_check
    CHECK (framework_key ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),

  CONSTRAINT canonical_framework_versions_version_nonempty
    CHECK (length(trim(framework_version)) > 0),

  CONSTRAINT canonical_framework_versions_display_nonempty
    CHECK (length(trim(display_name)) > 0)
);

COMMENT ON TABLE canonical_framework_versions IS
  'The versioned GLOBAL framework identity. Makes (framework_key, '
  'framework_version) an enumerable identity instead of free text, and — via '
  'UNIQUE (display_name, framework_version) — makes the reverse resolution from '
  'a tenant frameworks row deterministic. MIRRORS src/api/lib/controls/'
  'canonicalFrameworkIdentity.ts; canonicalFrameworkIdentity.test.ts asserts the '
  'two agree, so drift fails CI rather than producing a crosswalk that joins to '
  'nothing.';

-- The registry. This SQL mirrors CANONICAL_FRAMEWORK_VERSIONS in
-- src/api/lib/controls/canonicalFrameworkIdentity.ts. Two implementations of
-- one list is a duplication with a cost, taken deliberately for the same reason
-- 20260926 took it: the migration must run without an application boot, and the
-- module must resolve identities for frameworks created after this migration.
-- A lockstep test asserts the two agree.
--
-- Every (display_name, version) pair below is one that this codebase actually
-- writes into `frameworks`: the FRAMEWORK_TEMPLATES entries used by
-- POST /api/frameworks/activate, plus the FRAMEWORK_REFS entries used by
-- templateLoader. Both are covered, because a tenant requirement can arrive by
-- either path.
INSERT INTO canonical_framework_versions (framework_key, framework_version, display_name)
VALUES
  ('soc2',                 '2017',  'SOC 2 Type II'),
  ('nist-csf',             '1.1',   'NIST Cybersecurity Framework'),
  ('nist-csf',             '2.0',   'NIST Cybersecurity Framework'),
  ('iso-27001',            '2022',  'ISO/IEC 27001'),
  ('iso-42001',            '2023',  'ISO/IEC 42001'),
  ('hipaa-security-rule',  '2024',  'HIPAA Security Rule'),
  ('pci-dss',              '4.0',   'PCI DSS'),
  ('pci-dss',              '4.0.1', 'PCI DSS'),
  ('nist-sp-800-53',       'Rev 5', 'NIST SP 800-53'),
  ('cis-controls',         'v8',    'CIS Controls'),
  ('gdpr',                 '2018',  'GDPR'),
  ('ccpa-cpra',            '2023',  'CCPA / CPRA'),
  ('sox-it-controls',      '2002',  'SOX IT Controls'),
  ('dora',                 '2025',  'DORA'),
  ('nist-ai-rmf',          '1.0',   'NIST AI RMF'),
  ('ny-dfs-23-nycrr-500',  '2024',  'NY DFS 23 NYCRR 500'),
  ('eu-ai-act',            '2024',  'EU AI Act'),
  ('hitrust-csf',          '11.0',  'HITRUST CSF')
ON CONFLICT (framework_key, framework_version) DO NOTHING;

-- ---------------------------------------------------------------
-- 2. frameworks.framework_key — the tenant row's canonical identity
-- ---------------------------------------------------------------
ALTER TABLE frameworks
  ADD COLUMN IF NOT EXISTS framework_key TEXT NULL;

-- Backfill by exact (name, version) match against the registry. Exact, not
-- fuzzy: a near-match is a wrong canonical identity, and a wrong identity here
-- would attach one framework's crosswalk to another framework's requirements.
-- Anything that does not match stays NULL, which is a legitimate state.
UPDATE frameworks f
   SET framework_key = cfv.framework_key
  FROM canonical_framework_versions cfv
 WHERE f.framework_key IS NULL
   AND f.name    = cfv.display_name
   AND f.version = cfv.framework_version;

-- A non-null key must name a real framework version. MATCH SIMPLE (the
-- default) means the FK is not enforced while framework_key IS NULL, which is
-- exactly the semantics wanted: a customer-authored framework is unconstrained.
ALTER TABLE frameworks
  DROP CONSTRAINT IF EXISTS frameworks_canonical_identity_fkey;
ALTER TABLE frameworks
  ADD CONSTRAINT frameworks_canonical_identity_fkey
  FOREIGN KEY (framework_key, version)
  REFERENCES canonical_framework_versions (framework_key, framework_version)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_frameworks_canonical_identity
  ON frameworks (framework_key, version)
  WHERE framework_key IS NOT NULL;

COMMENT ON COLUMN frameworks.framework_key IS
  'The canonical framework identity for this tenant row, resolved from '
  'canonical_framework_versions. With `version`, it is the join key from a '
  'tenant requirement to the global crosswalk. NULL is legitimate and means '
  '"customer-authored framework with no SecureLogic canonical identity" — a '
  'positive state, not a missing value. `name` remains a mutable display '
  'string and is NEVER the join key.';

-- ---------------------------------------------------------------
-- 3. canonical_control_crosswalk — versioned requirement <-> canonical control
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_control_crosswalk (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The versioned GLOBAL requirement identity. Not requirements.id: that row
  -- is tenant-scoped through frameworks.organization_id, so a global table
  -- referencing it would stop being global.
  framework_key          TEXT        NOT NULL,
  framework_version      TEXT        NOT NULL,
  requirement_reference  TEXT        NOT NULL,

  canonical_control_id   UUID        NOT NULL
                                     REFERENCES canonical_controls(id) ON DELETE RESTRICT,

  -- securelogic  — authored by SecureLogic curation
  -- ai_proposed  — a model proposed it; it CANNOT reach published without a
  --                human approver (the authority CHECK below)
  -- customer     — a customer-contributed mapping (Ruling 2: customers may
  --                strengthen, never silently narrow the canonical baseline)
  mapping_source         TEXT        NOT NULL,
  mapping_rationale      TEXT        NULL,

  -- The reference-content version this mapping belongs to, e.g. '2026.08.1'.
  -- Free text by design: it labels a curation pass, not a semver artifact.
  mapping_version        TEXT        NOT NULL,

  status                 TEXT        NOT NULL DEFAULT 'proposed',

  -- Who proposed it, as a KIND plus an opaque reference, so an AI proposal is
  -- structurally distinguishable from a curator's without parsing a string.
  proposed_by_actor_kind TEXT        NOT NULL,
  proposed_by_actor_ref  TEXT        NULL,

  -- RESTRICT for the same reason as canonical_controls.published_by_user_id:
  -- an approved mapping must keep naming its approver.
  approved_by_user_id    UUID        NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at            TIMESTAMPTZ NULL,

  effective_from         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at          TIMESTAMPTZ NULL,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_control_crosswalk_framework_fkey
    FOREIGN KEY (framework_key, framework_version)
    REFERENCES canonical_framework_versions (framework_key, framework_version)
    ON UPDATE RESTRICT ON DELETE RESTRICT,

  CONSTRAINT canonical_control_crosswalk_source_check
    CHECK (mapping_source IN ('securelogic', 'ai_proposed', 'customer')),

  CONSTRAINT canonical_control_crosswalk_status_check
    CHECK (status IN ('proposed', 'approved', 'published', 'superseded')),

  CONSTRAINT canonical_control_crosswalk_actor_kind_check
    CHECK (proposed_by_actor_kind IN ('securelogic_curator', 'ai_extraction', 'customer')),

  -- THE publication boundary. AI may propose; it may not publish. A mapping
  -- only becomes authoritative when a human is named against it.
  CONSTRAINT canonical_control_crosswalk_approval_authority_check
    CHECK (
      (status = 'proposed'
        AND approved_by_user_id IS NULL AND approved_at IS NULL)
      OR
      (status IN ('approved', 'published', 'superseded')
        AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
    ),

  CONSTRAINT canonical_control_crosswalk_supersession_check
    CHECK (
      (status = 'superseded' AND superseded_at IS NOT NULL)
      OR
      (status <> 'superseded' AND superseded_at IS NULL)
    ),

  CONSTRAINT canonical_control_crosswalk_reference_nonempty
    CHECK (length(trim(requirement_reference)) > 0),

  CONSTRAINT canonical_control_crosswalk_mapping_version_nonempty
    CHECK (length(trim(mapping_version)) > 0)
);

-- One LIVE mapping per (versioned requirement, canonical control). Retired rows
-- are excluded so history accumulates instead of colliding.
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_control_crosswalk_live_unique
  ON canonical_control_crosswalk
     (framework_key, framework_version, requirement_reference, canonical_control_id)
  WHERE superseded_at IS NULL;

-- The read path: what does this versioned requirement map to?
CREATE INDEX IF NOT EXISTS idx_canonical_control_crosswalk_requirement
  ON canonical_control_crosswalk
     (framework_key, framework_version, requirement_reference, status);

-- The reverse read path: what does this canonical control satisfy?
CREATE INDEX IF NOT EXISTS idx_canonical_control_crosswalk_control
  ON canonical_control_crosswalk (canonical_control_id, status);

COMMENT ON TABLE canonical_control_crosswalk IS
  'GLOBAL, governed, versioned requirement <-> canonical control crosswalk. '
  'Keyed on the stable reference identity (framework_key, framework_version, '
  'requirement_reference), NOT requirements.id, which is tenant-scoped. '
  'Many-to-many in both directions. `control_mappings` is unchanged and remains '
  'the tenant-resolved view; materialising tenant mappings from published rows '
  'here is a separate step.';

COMMENT ON COLUMN canonical_control_crosswalk.status IS
  '''proposed'' -> ''approved'' -> ''published'' -> ''superseded''. A row cannot '
  'leave ''proposed'' without a named human approver — the CHECK is what makes '
  '"AI may propose, AI may not publish" structural rather than conventional. '
  'A published row is frozen; a correction is a NEW row and the old one is '
  'retired by superseded_at, so past decisions stay reconstructible.';

-- ---------------------------------------------------------------
-- Publication immutability — the crosswalk's state machine
-- ---------------------------------------------------------------
-- UPDATE only. See 20261067's header for why no DELETE/TRUNCATE trigger is
-- written here.
CREATE OR REPLACE FUNCTION canonical_control_crosswalk_guard_publication()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('proposed', 'approved') THEN
    -- Not yet authoritative: still editable, but the identity of what is being
    -- mapped may never change under an approval that was given for something
    -- else.
    IF OLD.status = 'approved'
       AND (NEW.framework_key         IS DISTINCT FROM OLD.framework_key
         OR NEW.framework_version     IS DISTINCT FROM OLD.framework_version
         OR NEW.requirement_reference IS DISTINCT FROM OLD.requirement_reference
         OR NEW.canonical_control_id  IS DISTINCT FROM OLD.canonical_control_id)
    THEN
      RAISE EXCEPTION
        'canonical_control_crosswalk: an approved mapping may not be repointed (% % %)',
        OLD.framework_key, OLD.framework_version, OLD.requirement_reference;
    END IF;
    RETURN NEW;
  END IF;

  -- OLD.status IS 'published' or 'superseded': frozen.
  IF NEW.framework_key          IS DISTINCT FROM OLD.framework_key
     OR NEW.framework_version      IS DISTINCT FROM OLD.framework_version
     OR NEW.requirement_reference  IS DISTINCT FROM OLD.requirement_reference
     OR NEW.canonical_control_id   IS DISTINCT FROM OLD.canonical_control_id
     OR NEW.mapping_source         IS DISTINCT FROM OLD.mapping_source
     OR NEW.mapping_rationale      IS DISTINCT FROM OLD.mapping_rationale
     OR NEW.mapping_version        IS DISTINCT FROM OLD.mapping_version
     OR NEW.proposed_by_actor_kind IS DISTINCT FROM OLD.proposed_by_actor_kind
     OR NEW.proposed_by_actor_ref  IS DISTINCT FROM OLD.proposed_by_actor_ref
     OR NEW.approved_by_user_id    IS DISTINCT FROM OLD.approved_by_user_id
     OR NEW.approved_at            IS DISTINCT FROM OLD.approved_at
     OR NEW.effective_from         IS DISTINCT FROM OLD.effective_from
     OR NEW.created_at             IS DISTINCT FROM OLD.created_at
     OR NEW.id                     IS DISTINCT FROM OLD.id
  THEN
    RAISE EXCEPTION
      'canonical_control_crosswalk is immutable once published (% % % -> %): supersede it instead',
      OLD.framework_key, OLD.framework_version, OLD.requirement_reference,
      OLD.canonical_control_id;
  END IF;

  IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'superseded') THEN
    RAISE EXCEPTION
      'canonical_control_crosswalk: % % % may only move from published to superseded',
      OLD.framework_key, OLD.framework_version, OLD.requirement_reference;
  END IF;

  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION
      'canonical_control_crosswalk: superseded is terminal (% % %)',
      OLD.framework_key, OLD.framework_version, OLD.requirement_reference;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION canonical_control_crosswalk_guard_publication() IS
  'State machine for governed reference content. Deliberately NOT absorbed into '
  'worm_guard_mutation (20261017), which owns the unconditional DELETE/TRUNCATE '
  'policy; this covers UPDATE only.';

DROP TRIGGER IF EXISTS canonical_control_crosswalk_publication_guard ON canonical_control_crosswalk;
CREATE TRIGGER canonical_control_crosswalk_publication_guard
  BEFORE UPDATE ON canonical_control_crosswalk
  FOR EACH ROW EXECUTE FUNCTION canonical_control_crosswalk_guard_publication();

GRANT SELECT ON canonical_framework_versions TO app_request;
GRANT SELECT ON canonical_control_crosswalk  TO app_request;
