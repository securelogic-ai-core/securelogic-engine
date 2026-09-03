-- Migration: vendor_contacts
-- Package:   Vendor Assurance — VA-C1 (vendor organization + contact foundation)
--
-- THE VENDOR BECOMES AN ORGANISATION WITH PEOPLE IN IT.
--
-- Until now a "vendor contact" was a free-typed email on ONE invite row: a
-- snapshot of a string somebody entered once, per engagement, with no identity
-- behind it. You could not re-invite the same person next quarter, could not
-- see who at a supplier you deal with, and could not name a second person at
-- all. Every collaboration feature that follows (participants, delegation)
-- needs a durable person to hang authorisation and attribution on, and this is
-- that person.
--
-- ── What this table is NOT ────────────────────────────────────────────────
--
-- It is not a user account. A vendor contact has no login, no password and no
-- session; they are a data subject we hold PII for WITHOUT an account, exactly
-- like vendor_engagement_invites.contact_email today — which is why this table
-- is Category C / piiRisk high in dataClassification.ts and why an erasure
-- request can arrive from someone who has never signed in.
--
-- It is also not an engagement participant. Being a contact at a supplier is a
-- standing fact about the relationship; taking part in one assessment is not.
-- VA-P1 adds the participation record and points it HERE. Collapsing the two
-- would mean removing somebody from one questionnaire deleted them from the
-- supplier's directory.
--
-- ── The invite keeps its snapshot ─────────────────────────────────────────
--
-- `vendor_engagement_invites` gains `contact_id`, but KEEPS contact_email and
-- contact_name. The snapshot is the historical record — who we actually mailed,
-- at the address we actually used — and it must not silently change when
-- somebody edits the contact's row two years later. The FK is ON DELETE SET
-- NULL for the same reason: losing the link must never rewrite the history of
-- who was invited. (Deletion is also refused at the route while any invite
-- still points here; deactivation is the intended path.)
--
-- ── Owner ruling 2026-08-23, recorded here because this is where someone
--    would be tempted to violate it ────────────────────────────────────────
--
-- Vendor-level criticality and per-engagement assessment tier are DIFFERENT
-- CONCEPTS and must never be collapsed. Both already exist:
--   vendors.criticality                     enduring relationship significance
--   vendor_engagements.assessment_tier      the depth of ONE assessment
-- This migration therefore adds NO criticality/tier column. Beginning an
-- engagement must not erase the vendor's classification, and the way to keep
-- that true is to not create a second place to write it.
--
-- Additive only. Empty at birth. RLS lands with the table.

CREATE TABLE IF NOT EXISTS vendor_contacts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id           UUID        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  full_name           TEXT        NOT NULL,
  -- Stored as entered; matched case-insensitively (see the unique index). An
  -- address is how a human is reached, not an identifier we may normalise on
  -- their behalf.
  email               TEXT        NOT NULL,
  title               TEXT        NULL,
  phone               TEXT        NULL,

  -- What this person is to us. Deliberately NOT called 'primary': the primary
  -- RESPONDENT on a questionnaire is an engagement-level role that VA-P1 owns,
  -- and one word for two concepts is how they get collapsed.
  contact_role        TEXT        NOT NULL DEFAULT 'security'
                        CHECK (contact_role IN
                          ('security', 'privacy', 'legal', 'executive', 'commercial', 'other')),
  is_primary_contact  BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Contacts DEACTIVATE, they do not disappear: their name is attached to
  -- answers and evidence that outlive their employment.
  status              TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive')),
  notes               TEXT        NULL,

  created_by_user_id  UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vendor_contacts_full_name_nonempty CHECK (length(trim(full_name)) > 0),
  CONSTRAINT vendor_contacts_email_shape CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

-- One person per address per supplier. Case-insensitive because a vendor who
-- writes Jane@ and jane@ is one Jane, and two rows would mean two credentials.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_contacts_identity
  ON vendor_contacts (organization_id, vendor_id, lower(email));

-- At most one primary contact per supplier, and only among live rows: a
-- departed primary must not block naming their successor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_contacts_primary
  ON vendor_contacts (organization_id, vendor_id)
  WHERE is_primary_contact AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_vendor_contacts_vendor
  ON vendor_contacts (organization_id, vendor_id, status);

COMMENT ON TABLE vendor_contacts IS
  'People at a THIRD-PARTY supplier. Not platform users: no account, no login, '
  'no session — a data subject we hold PII for without a login, so an erasure '
  'request can arrive from someone who never signed in. Standing relationship '
  'facts; participation in a specific assessment is a separate record (VA-P1).';

COMMENT ON COLUMN vendor_contacts.is_primary_contact IS
  'The standing primary contact at the supplier. NOT the primary respondent on '
  'an engagement — that is an engagement-level role (VA-P1).';

-- ---------------------------------------------------------------
-- The invite learns which person it was sent to
-- ---------------------------------------------------------------
--
-- Nullable, because every invite issued before this migration was sent to a
-- typed string and there is no honest way to invent the person behind it.
-- SET NULL on delete: losing the link must never rewrite the record of who was
-- actually invited, which is what contact_email/contact_name preserve.

ALTER TABLE vendor_engagement_invites
  ADD COLUMN IF NOT EXISTS contact_id UUID NULL
    REFERENCES vendor_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_engagement_invites_contact
  ON vendor_engagement_invites (contact_id)
  WHERE contact_id IS NOT NULL;

COMMENT ON COLUMN vendor_engagement_invites.contact_id IS
  'The vendor_contacts row this invite was sent to. NULL for invites issued '
  'before VA-C1 and for ad-hoc addresses. contact_email/contact_name remain the '
  'historical snapshot and are never rewritten from the contact row.';

-- ---------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------
-- Standard tenant isolation. Unlike the invite/session tables there is no
-- pre-org-context resolver here: a vendor contact is only ever read by an
-- authenticated customer request that already has an org.

ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_contacts_tenant_isolation ON vendor_contacts;
CREATE POLICY vendor_contacts_tenant_isolation ON vendor_contacts
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_contacts TO app_request;
