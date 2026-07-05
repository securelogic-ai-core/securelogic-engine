/**
 * assetRegistry.ts — the canonical Enterprise Asset contract (EAR Phase 0).
 *
 * Design authority: docs/architecture/enterprise-asset-registry/ARCHITECTURE.md
 * §2.2 (contract) and §2.3 (per-type mapping). The registry FEDERATES the
 * existing asset-bearing tables (EAR-AD-1); it never copies load-bearing
 * attributes (EAR-AD-2). In Phase 0 the canonical projection is the SQL VIEW
 * `asset_registry_v` (20260802 migration) over vendors ∪ ai_systems ∪
 * enterprise_entities; `asset_id` equals the backing row id until the Tier-0
 * `assets` table ships in Phase 1 and the view's identity source is repointed.
 *
 * The AssetTypeSpec registry is the code-level capability table that Phase 2
 * uses to replace the two hard-coded chokepoints (GRAPH_REPRESENTABLE and the
 * matcher's per-type branches — ARCHITECTURE.md §1.4). In Phase 0 it is
 * declarative truth only: the flags reflect TODAY's shipped behavior, so no
 * consumer changes until Phase 2 deliberately rewires them.
 */

/** Extensible in exactly one place (ARCHITECTURE.md §2.2). */
export const ASSET_TYPES = [
  "vendor",
  "ai_system",
  "application",
  "database",
  "cloud_resource",
  "endpoint",
  "api",
  "identity_system",
  "business_process",
  "generic"
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export function isAssetType(v: unknown): v is AssetType {
  return typeof v === "string" && (ASSET_TYPES as readonly string[]).includes(v);
}

/** Replaces ad-hoc `(type, id)` pairs in NEW code (EAR-AD-3). */
export interface AssetRef {
  asset_type: AssetType;
  asset_id: string;
}

/** Criticality vocabulary — CHECK-constrained identically on all three backing
 * tables (vendors since 20260412; ai_systems 20260414; enterprise_entities
 * 20260718): critical/high/medium/low, NULL allowed. */
export type Criticality = "critical" | "high" | "medium" | "low";

/** The `asset_registry_v` row projection (EAR-AD-2 — attributes are READ from
 * the backing table via the view, never copied into registry storage). */
export interface CanonicalAsset {
  asset_id: string;
  asset_type: AssetType;
  organization_id: string;
  name: string;
  criticality: Criticality | null;
  owner_user_id: string | null;
  status: string;
  backing_kind: string;
  backing_id: string;
  /** NULL until the Tier-0 `assets` table ships (Phase 1). */
  lifecycle_status: string | null;
  created_at: string;
  updated_at: string;
}

/** Code-level capability registry (ARCHITECTURE.md §2.2). */
export interface AssetTypeSpec {
  type: AssetType;
  /** Tier-1 backing detail table (EAR-AD-1 federation target). */
  backingKind: "vendors" | "ai_systems" | "enterprise_entities" | (string & {});
  /** Replaces the GRAPH_REPRESENTABLE hard-code (consumed in Phase 2). */
  graphRepresentable: boolean;
  /** Participates in matcher/applicability as a risk target (Phase 2). */
  isRiskTarget: boolean;
  /** Replaces the matcher's per-type branches (Phase 2). */
  matchStrategy: "name_canonical" | "cve" | "domain" | "none";
  /** Tier-2 typed child holding load-bearing typed attributes, if any. */
  typedChild?: string;
}

/**
 * Phase-0 truth table: flags mirror CURRENTLY SHIPPED behavior exactly
 * (vendor/ai_system are the two graph-representable, name-matched risk targets
 * — ARCHITECTURE.md §1.3/§1.4). New types onboard in Phase 3; flags flip in
 * Phase 2/3 when the consuming code paths are actually generalized.
 */
export const ASSET_TYPE_SPECS: Readonly<Record<AssetType, AssetTypeSpec>> = {
  vendor: {
    type: "vendor",
    backingKind: "vendors",
    graphRepresentable: true,
    isRiskTarget: true,
    matchStrategy: "name_canonical"
  },
  ai_system: {
    type: "ai_system",
    backingKind: "ai_systems",
    graphRepresentable: true,
    isRiskTarget: true,
    matchStrategy: "name_canonical"
  },
  application: {
    type: "application",
    backingKind: "enterprise_entities",
    graphRepresentable: false,
    isRiskTarget: false,
    matchStrategy: "none"
  },
  database: {
    type: "database",
    backingKind: "enterprise_entities",
    graphRepresentable: false,
    isRiskTarget: false,
    matchStrategy: "none",
    typedChild: "enterprise_data_stores"
  },
  cloud_resource: {
    type: "cloud_resource",
    backingKind: "cloud_resources",
    graphRepresentable: false,
    isRiskTarget: false,
    matchStrategy: "none"
  },
  endpoint: {
    type: "endpoint",
    backingKind: "endpoints",
    graphRepresentable: false,
    isRiskTarget: false,
    matchStrategy: "none"
  },
  api: {
    type: "api",
    backingKind: "apis",
    graphRepresentable: false,
    isRiskTarget: false,
    matchStrategy: "none"
  },
  identity_system: {
    type: "identity_system",
    backingKind: "identity_systems",
    graphRepresentable: false,
    isRiskTarget: false,
    matchStrategy: "none"
  },
  business_process: {
    type: "business_process",
    backingKind: "enterprise_entities",
    graphRepresentable: false,
    isRiskTarget: false,
    matchStrategy: "none"
  },
  generic: {
    type: "generic",
    backingKind: "enterprise_entities",
    graphRepresentable: false,
    isRiskTarget: false,
    matchStrategy: "none"
  }
} as const;

/**
 * enterprise_entities.entity_type → asset_type projection used by the Phase-0
 * view (must stay in lockstep with the CASE in 20260802_asset_registry_view.sql
 * — asserted by unit test). `identity` maps to generic on purpose: those rows
 * are identity ACCOUNTS, not identity systems (ARCHITECTURE.md §2.3).
 */
export const ENTITY_TYPE_TO_ASSET_TYPE: Readonly<Record<string, AssetType>> = {
  application: "application",
  data_store: "database"
  // every other entity_type (asset, business_service, business_unit,
  // department, data_classification, identity) projects to "generic"
};

export function entityTypeToAssetType(entityType: string): AssetType {
  return ENTITY_TYPE_TO_ASSET_TYPE[entityType] ?? "generic";
}
