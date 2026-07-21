-- 20260905_asset_product_identity.sql
--
-- C4 / ADR-0003 D1 — how a tenant asset acquires PRODUCT identity.
--
-- WHY
--   ERG R2 permits an `affected` determination only on a high-confidence, explainable
--   match to a tenant asset. Nothing defined how an asset acquires product identity.
--   `tenantAssetResolver` matched on EXACT string equality of the asset's NAME against
--   `product_canonical` — so an asset had to be literally named "Exchange" to resolve to
--   product `exchange`. A realistically-named asset (EXCH-PROD-01, "Exchange Server
--   2019") never matched, and applicability would have resolved near-zero in any real
--   tenant: a silent no-op behind a flipped flag.
--
--   Two distinct problems, deliberately solved in two places:
--
--   1. PRODUCT-SIDE normalization — the outside world names one product many ways
--      ("Microsoft Exchange Server 2019", "Exchange Online"). Solved ORG-NEUTRALLY by
--      canonical_product_aliases, which already exists (20260830) and merely had no
--      writer. No schema change needed here.
--
--   2. ASSET-SIDE identity — "EXCH-PROD-01 is an Exchange server" is TENANT knowledge.
--      No org-neutral table can hold it. That is this migration.
--
-- ADR-0003 D1 (ACCEPTED): evidence-fed identity, with human attestation as an override.
--   Canonical enterprise context remains authoritative. Attestation is SUPPORTING
--   EVIDENCE that may override or strengthen applicability; it does NOT become the
--   primary source of truth and does NOT redefine canonical relationships. Hence a
--   dedicated evidence table — NOT a new entity_type, NOT a new enterprise_relationships
--   edge type, NOT a column on `assets`. The asset remains the canonical noun; this only
--   records what evidence says the asset RUNS.
--
-- NOT a second matcher (EAR-AD-3): this is an input to the single ApplicabilityEngineV1,
-- read by the existing tenantAssetResolver. No parallel resolution path.

CREATE TABLE IF NOT EXISTS asset_product_identities (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- The tenant asset. No FK: `assets.id` is the Tier-0 spine id, and the polymorphic
  -- AssetRef is resolved against asset_registry_v (same discipline as asset_assessments).
  asset_id             UUID        NOT NULL,

  -- The org-neutral canonical product the evidence says this asset runs.
  canonical_product_id UUID        NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,

  -- WHERE the identity came from. Ordered by authority, and the resolver ranks on it:
  --   attestation — a human explicitly declared it (ADR-0003 D1-B override)
  --   sbom        — component/SBOM evidence
  --   connector   — a discovery connector observed it
  --   inferred    — the legacy asset-name == product_canonical match, recorded so that
  --                 a weak match is VISIBLE as weak rather than silently equal to
  --                 evidence. Never written by this migration; reserved for the resolver.
  provenance           TEXT        NOT NULL,

  -- 0-100. The resolver passes this to the applicability engine, which gates `affected`
  -- against applicabilityPolicy.ts thresholds. Evidence quality is NOT re-invented here.
  confidence           INTEGER     NOT NULL DEFAULT 100,

  -- What the evidence actually was, for explainability (ERG R2: "explainable match").
  -- Free text by design: a connector id, an SBOM component ref, an advisory URL.
  evidence_ref         TEXT        NULL,

  -- Set only for provenance='attestation'.
  attested_by_user_id  UUID        NULL REFERENCES users(id) ON DELETE SET NULL,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT asset_product_identities_provenance_chk
    CHECK (provenance IN ('attestation', 'sbom', 'connector', 'inferred')),

  CONSTRAINT asset_product_identities_confidence_chk
    CHECK (confidence BETWEEN 0 AND 100),

  -- A human attestation must name the human. Machine evidence must not pretend to.
  CONSTRAINT asset_product_identities_attestation_actor_chk
    CHECK (
      (provenance = 'attestation' AND attested_by_user_id IS NOT NULL)
      OR
      (provenance <> 'attestation' AND attested_by_user_id IS NULL)
    )
);

-- One row per (asset, product, provenance): a connector and a human may BOTH claim the
-- same identity, and the resolver ranks them rather than one silently clobbering the
-- other. Human attestation wins because 'attestation' sorts first in the ranking, not
-- because it overwrote the machine's row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_product_identities_unique
  ON asset_product_identities (organization_id, asset_id, canonical_product_id, provenance);

-- The resolver's read path: given a product, which of this org's assets run it?
CREATE INDEX IF NOT EXISTS idx_asset_product_identities_by_product
  ON asset_product_identities (organization_id, canonical_product_id);

-- The asset detail path: what does this asset run?
CREATE INDEX IF NOT EXISTS idx_asset_product_identities_by_asset
  ON asset_product_identities (organization_id, asset_id);

-- Tenant data -> RLS, same NULLIF GUC pattern as assets / enterprise_entities.
-- ENABLE (not FORCE), consistent with the rest of the estate.
ALTER TABLE asset_product_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_product_identities_tenant_isolation ON asset_product_identities;
CREATE POLICY asset_product_identities_tenant_isolation
  ON asset_product_identities
  FOR ALL
  USING      (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON asset_product_identities TO app_request;
