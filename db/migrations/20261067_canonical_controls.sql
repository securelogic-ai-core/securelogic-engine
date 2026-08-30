-- Migration: canonical_controls (+ aliases)
-- Package:   VA-S4 Step 1 — canonical control identity foundation (slot 20261067)
-- Docs:      docs/design/VA-CANONICAL-CONTROL-IDENTITY-reconciliation.md
--            docs/design/VA-S4-assurance-wiring-plan.md §7 step 1
--
-- Owner ruling, 2026-08-30: a new GLOBALLY SCOPED SecureLogic canonical control
-- identity is approved. Not `controls.id` (tenant-scoped). Not the existing
-- `{industry}:control:*` slugs as the permanent namespace — those are retained
-- as ALIASES so their historical meaning survives.
--
-- ── What a canonical control IS ─────────────────────────────────────────────
--
-- A reusable ASSURANCE / CONTROL CONCEPT. It is NOT a framework requirement,
-- and the crosswalk (20261068) is deliberately many-to-many in both directions:
--
--     Framework Requirement  <->  Canonical Control  <->  Tenant Control
--
-- One canonical control may satisfy requirements across several frameworks; one
-- requirement may need several canonical controls. NIST CSF is only the first
-- proof corpus, so no framework identity is encoded in the canonical key.
--
-- ── Why a new entity rather than `controls.canonical_control_key` ───────────
--
-- The reconciliation report answered this in full (§4.2). In short: a key
-- column on `controls` allows exactly ONE canonical identity per control,
-- carries no provenance, makes "no canonical identity" indistinguishable from
-- "not yet linked", and puts governed reference data inside a tenant-editable
-- row. The tenant side is 20261069, mirroring `asset_product_identities`.
--
-- ── Global, therefore no organization_id and no RLS ─────────────────────────
--
-- Same posture, and the same reasoning, as `canonical_products` (20260830):
-- these tables hold NO tenant data, so there is structurally nothing to leak
-- across tenants. That is the safest isolation posture, not an omission. The
-- ONE table in this package that holds tenant data — control_canonical_identities
-- — carries organization_id, RLS and a policy, in 20261069.
--
-- ── The key grammar is enforced, not conventional ──────────────────────────
--
-- `securelogic:control:<stable-key>`, lower-kebab. A CHECK enforces the shape,
-- so the namespace cannot drift by convention alone, and an alias can never
-- occupy it (see canonical_control_aliases below). The key is independent of
-- tenant, industry template, framework and display title — none of those appear
-- in it, deliberately.
--
-- ── Immutable once published ────────────────────────────────────────────────
--
-- A published row's content is frozen by a BEFORE UPDATE state machine; a
-- correction is a NEW row that supersedes the old one, never an in-place edit.
-- That is what makes historical reconstruction possible: a decision taken
-- against `securelogic:control:mfa-privileged-access` v1 can still be read back
-- exactly as it stood.
--
-- The trigger is BEFORE UPDATE ONLY, deliberately. Every DELETE/TRUNCATE
-- refusal in this database resolves to the single shared `worm_guard_mutation`
-- (20261017), and wormGuardConsolidation.test.ts fails the build for any
-- trigger that covers DELETE or TRUNCATE without it. Deletion of a published
-- row is instead prevented where it actually matters, structurally: every
-- reference to a canonical control — from the crosswalk (20261068) and from the
-- tenant identity table (20261069) — is ON DELETE RESTRICT. A published control
-- that nothing has used yet is removable, and removing it destroys no history
-- because it appears in none.
--
-- DARK + ADDITIVE + REVERSIBLE: pure CREATE, no writes to any existing table,
-- no backfill, no locks on existing tables. Nothing reads these tables yet.
-- Rollback: docs/release/ROLLBACK-20261067.sql
-- Idempotent and re-runnable.

-- ---------------------------------------------------------------
-- canonical_controls — the global control identity
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_controls (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The identity. Globally unique, stable, immutable once published, and
  -- independent of tenant / industry / framework / display title.
  canonical_key         TEXT        NOT NULL UNIQUE,

  display_name          TEXT        NOT NULL,
  description           TEXT        NULL,

  -- Free TEXT, mirroring `controls.control_family`, which has no CHECK. A
  -- closed family vocabulary is a separate curation decision and is NOT
  -- invented here to look tidy.
  control_family        TEXT        NULL,

  -- draft      — authored, not authoritative, freely editable
  -- published  — governed reference content; frozen (see the trigger)
  -- superseded — replaced by a successor row; frozen
  status                TEXT        NOT NULL DEFAULT 'draft',

  -- The successor points BACKWARD at what it replaces. Version chains are
  -- linear: a UNIQUE index below forbids two rows superseding the same one.
  supersedes_id         UUID        NULL REFERENCES canonical_controls(id) ON DELETE RESTRICT,

  -- Publication authority. RESTRICT, not SET NULL: a published governance
  -- decision must keep naming the human who published it, and nulling that
  -- actor would violate the authority CHECK below anyway — RESTRICT says so
  -- with an error a reader can act on.
  published_by_user_id  UUID        NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at          TIMESTAMPTZ NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT canonical_controls_status_check
    CHECK (status IN ('draft', 'published', 'superseded')),

  -- The namespace is structural. `securelogic:control:` + lower-kebab slug.
  CONSTRAINT canonical_controls_key_grammar_check
    CHECK (canonical_key ~ '^securelogic:control:[a-z0-9]+(-[a-z0-9]+)*$'),

  CONSTRAINT canonical_controls_display_name_nonempty
    CHECK (length(trim(display_name)) > 0),

  -- Authority is structural, exactly as `vendor_assurance_documents`
  -- (20261066) makes an accepted opinion impossible without an acceptor:
  -- a draft has no publisher; anything authoritative names one and when.
  CONSTRAINT canonical_controls_publication_authority_check
    CHECK (
      (status = 'draft'
        AND published_at IS NULL AND published_by_user_id IS NULL)
      OR
      (status IN ('published', 'superseded')
        AND published_at IS NOT NULL AND published_by_user_id IS NOT NULL)
    ),

  -- A row cannot supersede itself.
  CONSTRAINT canonical_controls_supersedes_not_self_check
    CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

-- Linear version chain: at most one successor per superseded row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_controls_supersedes_unique
  ON canonical_controls (supersedes_id)
  WHERE supersedes_id IS NOT NULL;

-- The read path: the published corpus, by family.
CREATE INDEX IF NOT EXISTS idx_canonical_controls_status
  ON canonical_controls (status, control_family);

COMMENT ON TABLE canonical_controls IS
  'GLOBAL SecureLogic canonical control identity. A reusable assurance/control '
  'CONCEPT — never a framework requirement, never tenant-scoped. Requirements '
  'relate to it many-to-many through canonical_control_crosswalk; tenant '
  'controls relate to it many-to-many through control_canonical_identities. No '
  'organization_id and no RLS by design: there is no tenant data here to leak.';

COMMENT ON COLUMN canonical_controls.canonical_key IS
  'securelogic:control:<stable-key>. Globally unique, stable, immutable once '
  'published, and independent of tenant, industry template, framework and '
  'display title. The grammar is a CHECK, not a convention. Existing '
  '{industry}:control:* slugs are ALIASES (canonical_control_aliases), never '
  'canonical keys — freezing an accident of origin into the identity is exactly '
  'what this namespace exists to avoid.';

COMMENT ON COLUMN canonical_controls.status IS
  '''draft'' = authored, not authoritative, freely editable. ''published'' = '
  'governed reference content, frozen. ''superseded'' = replaced by a successor, '
  'frozen. A correction to published content is a NEW row that supersedes the '
  'old one — never an in-place edit — so a past decision remains reconstructible.';

-- ---------------------------------------------------------------
-- canonical_control_aliases — explicit aliases + provenance
-- ---------------------------------------------------------------
--
-- Owner ruling: aliases are EXPLICIT aliases and must never become competing
-- canonical identities. Two structural guarantees, not two conventions:
--
--   1. `alias_key` is GLOBALLY UNIQUE, so alias resolution is deterministic —
--      an alias resolves to exactly one canonical control or to nothing.
--   2. an alias_key may never be spelled in the `securelogic:control:`
--      namespace, so the alias space and the canonical space cannot overlap.
--
-- `source` records where the alias came from, so a resolution is auditable
-- rather than merely correct. This is the same provenance discipline
-- `canonical_product_aliases` (20260830) applies to product names.
CREATE TABLE IF NOT EXISTS canonical_control_aliases (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_control_id  UUID        NOT NULL
                                    REFERENCES canonical_controls(id) ON DELETE RESTRICT,

  -- The historical identity being preserved, verbatim. For the shipped
  -- industry templates this is `TemplateControl.id`, e.g.
  -- 'b2b-ai:control:ai-use-policy' — the globally stable slug that
  -- templateLoader has been discarding at load since 20260505.
  alias_key             TEXT        NOT NULL,

  -- industry_template   — a `{industry}:control:{slug}` id from src/templates
  -- framework_reference — a framework's own control identifier
  -- legacy              — anything retained purely for migration compatibility
  alias_scheme          TEXT        NOT NULL,

  -- Provenance: which corpus/curation pass asserted this alias.
  source                TEXT        NOT NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Deterministic resolution: one canonical control per alias, globally.
  CONSTRAINT canonical_control_aliases_key_unique UNIQUE (alias_key),

  CONSTRAINT canonical_control_aliases_scheme_check
    CHECK (alias_scheme IN ('industry_template', 'framework_reference', 'legacy')),

  -- An alias can never be spelled as a canonical key. This is what keeps
  -- aliases from becoming a second canonical namespace.
  CONSTRAINT canonical_control_aliases_not_canonical_namespace_check
    CHECK (alias_key NOT LIKE 'securelogic:control:%'),

  CONSTRAINT canonical_control_aliases_key_nonempty
    CHECK (length(trim(alias_key)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_canonical_control_aliases_control
  ON canonical_control_aliases (canonical_control_id);

COMMENT ON TABLE canonical_control_aliases IS
  'Explicit aliases for a canonical control — never competing canonical '
  'identities. alias_key is GLOBALLY UNIQUE so resolution is deterministic, and '
  'a CHECK forbids an alias being spelled in the securelogic:control: '
  'namespace. Retaining the {industry}:control:* slugs here is what preserves '
  'their historical meaning through canonicalization.';

-- ---------------------------------------------------------------
-- Publication immutability — a state machine, not a WORM policy
-- ---------------------------------------------------------------
--
-- 20261017 consolidated the DELETE/TRUNCATE policy into one shared guard and
-- deliberately left STATE MACHINES (legal_holds, finding_risk_acceptances) in
-- their own functions, because folding domain rules into the shared guard would
-- make the shared thing table-aware. This is a third state machine and follows
-- that precedent. It covers UPDATE only — see the header.
CREATE OR REPLACE FUNCTION canonical_controls_guard_publication()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    -- Drafts are freely editable, but may not skip straight to superseded:
    -- nothing has been published, so there is nothing to supersede.
    IF NEW.status = 'superseded' THEN
      RAISE EXCEPTION
        'canonical_controls: a draft cannot be superseded (%): publish it first',
        OLD.canonical_key;
    END IF;
    RETURN NEW;
  END IF;

  -- OLD.status IS 'published' or 'superseded': content is frozen.
  IF NEW.canonical_key        IS DISTINCT FROM OLD.canonical_key
     OR NEW.display_name      IS DISTINCT FROM OLD.display_name
     OR NEW.description       IS DISTINCT FROM OLD.description
     OR NEW.control_family    IS DISTINCT FROM OLD.control_family
     OR NEW.supersedes_id     IS DISTINCT FROM OLD.supersedes_id
     OR NEW.published_at      IS DISTINCT FROM OLD.published_at
     OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id
     OR NEW.created_at        IS DISTINCT FROM OLD.created_at
     OR NEW.id                IS DISTINCT FROM OLD.id
  THEN
    RAISE EXCEPTION
      'canonical_controls is immutable once published (%): publish a superseding row instead of editing it',
      OLD.canonical_key;
  END IF;

  -- The only legal transition out of published.
  IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'superseded') THEN
    RAISE EXCEPTION
      'canonical_controls: % may only move from published to superseded',
      OLD.canonical_key;
  END IF;

  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION
      'canonical_controls: superseded is terminal (%)',
      OLD.canonical_key;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION canonical_controls_guard_publication() IS
  'State machine, not a WORM policy — deliberately NOT absorbed into '
  'worm_guard_mutation (20261017), which owns the unconditional DELETE/TRUNCATE '
  'policy. Covers UPDATE only: a trigger that covered DELETE or TRUNCATE would '
  'be a second copy of that policy and wormGuardConsolidation.test.ts would '
  'fail the build for it.';

DROP TRIGGER IF EXISTS canonical_controls_publication_guard ON canonical_controls;
CREATE TRIGGER canonical_controls_publication_guard
  BEFORE UPDATE ON canonical_controls
  FOR EACH ROW EXECUTE FUNCTION canonical_controls_guard_publication();

-- ---------------------------------------------------------------
-- Grants — read for the request role, writes only through the
-- governed publication path (an elevated script / migration).
-- ---------------------------------------------------------------
GRANT SELECT ON canonical_controls        TO app_request;
GRANT SELECT ON canonical_control_aliases TO app_request;
