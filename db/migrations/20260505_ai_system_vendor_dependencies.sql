-- Migration: ai_system_vendor_dependencies
-- Package: ai-system-vendor-dependencies
--
-- Creates:
--   ai_system_vendor_dependencies — explicit, user-driven, tenant-scoped record
--                                    that an AI system depends on a vendor in a
--                                    specific role. Establishes the edge that a
--                                    later matcher-cascade package will traverse:
--                                    when a CVE drops on a vendor, propagate the
--                                    suggestion to AI systems that depend on it.
--
-- Modifies: nothing. Additive only. No alters to ai_systems, vendors, or any
--           existing table. ai_systems has no pre-existing vendor relationship
--           (verified — see investigation findings on package 2 spec), so this
--           table is the canonical AI-system → vendor edge with no migration
--           story required.
--
-- Tenant rules (enforced at the application layer per
--               TENANT_ISOLATION_STANDARD.md §4):
--   - dep.organization_id is sourced from req.organizationContext, never from
--     the request body.
--   - ai_systems.organization_id MUST equal dep.organization_id.
--   - vendors.organization_id     MUST equal dep.organization_id.
--   - Both targets are first-class same-org entities (no global asymmetry,
--     unlike cyber_signals).
--
-- Soft delete: deleted_at IS NULL identifies live dependencies. The unique
--              index is partial on deleted_at IS NULL so a deleted row can be
--              recreated without uniqueness collision — same pattern as the
--              signal_*_links family.
--
-- Role taxonomy (CHECK enumerated below):
--   model_provider   — vendor supplies the model itself (OpenAI, Anthropic,
--                      Cohere, Mistral). The CVE-on-model-provider case is
--                      the obvious cascade path.
--   runtime          — vendor supplies the serving infrastructure that hosts
--                      inference at request time (AWS Bedrock, NVIDIA Triton,
--                      Modal, Replicate, vendor-hosted vLLM endpoints).
--   registry         — vendor hosts model artifacts or images the system
--                      pulls (HuggingFace, NGC, Docker Hub, ECR-as-a-service).
--   training_data    — vendor supplies training corpus or licensed data
--                      (Scale, Labelbox, Common Crawl mirrors, paid datasets).
--   feature_store    — vendor supplies the online/offline feature store
--                      (Tecton, Hopsworks, Feast managed).
--   mlops_platform   — vendor supplies end-to-end ML lifecycle tooling that
--                      spans training, registry, deployment, and monitoring
--                      as one product (Databricks, SageMaker, Vertex AI,
--                      Weights & Biases). Distinct from runtime: a vendor is
--                      an mlops_platform when the org uses the platform's
--                      higher-level lifecycle features, not just the inference
--                      endpoint. AWS Bedrock is runtime; AWS SageMaker is
--                      mlops_platform. Refine via migration if usage shows
--                      systematic confusion.
--   data_source      — vendor supplies live operational data the system reads
--                      at inference (Bloomberg market feeds, Refinitiv,
--                      Snowflake-as-source, vendor APIs).
--   observability    — vendor supplies model-output monitoring, drift, or
--                      eval tooling (Arize, Fiddler, WhyLabs, Evidently
--                      managed, LangSmith).
--   other            — escape hatch; if 'other' becomes common, audit the
--                      `notes` column to identify the missing role and add
--                      it via a follow-up migration.

CREATE TABLE IF NOT EXISTS ai_system_vendor_dependencies (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_system_id       UUID         NOT NULL REFERENCES ai_systems(id)    ON DELETE CASCADE,
  vendor_id          UUID         NOT NULL REFERENCES vendors(id)       ON DELETE CASCADE,
  dependency_role    TEXT         NOT NULL,
  notes              TEXT         NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by_user_id UUID         NULL     REFERENCES users(id)         ON DELETE SET NULL,
  deleted_at         TIMESTAMPTZ  NULL,

  CONSTRAINT ai_system_vendor_dependencies_role_chk
    CHECK (dependency_role IN (
      'model_provider',
      'runtime',
      'registry',
      'training_data',
      'feature_store',
      'mlops_platform',
      'data_source',
      'observability',
      'other'
    ))
);

-- One active row per (org, ai_system, vendor, role). The same vendor can
-- appear under multiple roles for the same AI system (e.g., AWS as both
-- runtime and data_source) because role is part of the key. Soft-deleted
-- rows are excluded so a previously-deleted dependency can be re-created.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_system_vendor_dependencies_unique_active
  ON ai_system_vendor_dependencies (organization_id, ai_system_id, vendor_id, dependency_role)
  WHERE deleted_at IS NULL;

-- Hot read: list a specific AI system's active dependencies.
CREATE INDEX IF NOT EXISTS idx_ai_system_vendor_dependencies_org_ai_system
  ON ai_system_vendor_dependencies (organization_id, ai_system_id)
  WHERE deleted_at IS NULL;

-- Hot read: list AI systems that depend on a specific vendor — the
-- cascade-side query the matcher will eventually use to propagate
-- vendor signals to dependent AI systems.
CREATE INDEX IF NOT EXISTS idx_ai_system_vendor_dependencies_org_vendor
  ON ai_system_vendor_dependencies (organization_id, vendor_id)
  WHERE deleted_at IS NULL;
