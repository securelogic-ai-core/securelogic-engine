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
 * The AssetTypeSpec registry is the code-level capability table that replaced
 * the two hard-coded chokepoints in Phase 2 (ARCHITECTURE.md §1.4): the
 * applicability engine + reassessment worker consume `graphRepresentable`
 * (via isGraphRepresentableTarget), and the matcher derives its name-matched
 * target set from `isRiskTarget`/`matchStrategy` — vendor/ai_system on the
 * live branches, enterprise_entities-backed types via the flag-gated generic
 * asset matcher.
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
 * Truth table (updated in Phase 2 — the chokepoints now CONSUME it):
 * `graphRepresentable` is true for every type whose backing rows exist as
 * ECL graph nodes today — vendors, ai_systems, and all enterprise_entities-
 * backed types (application/database/business_process/generic) — the graph
 * substrate has carried edges between those node types since ECL S2/EAR-AD-4.
 * `isRiskTarget`/`matchStrategy` remain vendor/ai_system-only until Phase 3
 * onboards new types; the generic asset matcher (Phase 2) matches
 * enterprise_entities-backed inventory behind the registry flag.
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
    graphRepresentable: true,
    isRiskTarget: true,
    matchStrategy: "name_canonical"
  },
  database: {
    type: "database",
    backingKind: "enterprise_entities",
    graphRepresentable: true,
    isRiskTarget: true,
    matchStrategy: "name_canonical",
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
    graphRepresentable: true,
    isRiskTarget: false,
    matchStrategy: "none"
  },
  generic: {
    type: "generic",
    backingKind: "enterprise_entities",
    graphRepresentable: true,
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

/**
 * Phase 2 bridge: is a MATCH TARGET graph-representable (can carry a blast
 * radius)? Replaces the two GRAPH_REPRESENTABLE hard-codes (ARCHITECTURE.md
 * §1.4). Match-target vocabulary is the quartet + 'asset' (EAR-AD-3 — the
 * quartet stops growing; new types target the registry generically):
 *   - vendor / ai_system   → their spec (true);
 *   - control / obligation → false — canonical GRC objects, not graph nodes
 *     (they reach 'affected' via the R1b non-graph rule instead);
 *   - asset                → the registry row's asset_type spec (callers pass
 *     it from assets.asset_type; unknown/absent → false, fail-closed).
 * Pure config — safe to import from the pure engine.
 */
export function isGraphRepresentableTarget(
  targetType: string,
  assetType?: string | null
): boolean {
  if (targetType === "vendor" || targetType === "ai_system") {
    return ASSET_TYPE_SPECS[targetType].graphRepresentable;
  }
  if (targetType === "asset") {
    return isAssetType(assetType) ? ASSET_TYPE_SPECS[assetType].graphRepresentable : false;
  }
  return false;
}
