/**
 * assetRegistry.ts — pure, I/O-free types + helpers for the unified Assets
 * surface (EAR Phase 4). Mirrors the engine's canonical asset contract
 * (src/api/lib/assetRegistry.ts on develop): ASSET_TYPES and the
 * asset_registry_v row projection served by GET /api/assets.
 *
 * No fetch/network code here (the app's pure-function test convention); the
 * fetch wrapper lives in api.ts. The registry surface is dark: the engine
 * routes 404 while SECURELOGIC_ASSET_REGISTRY_ENABLED is off and return 403
 * capability_required without the `enterprise_context` capability — the UI
 * classifies both via the shared readFailure helpers.
 */

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
  "generic",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export function isAssetType(v: unknown): v is AssetType {
  return typeof v === "string" && (ASSET_TYPES as readonly string[]).includes(v);
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  vendor: "Vendor",
  ai_system: "AI System",
  application: "Application",
  database: "Database",
  cloud_resource: "Cloud Resource",
  endpoint: "Endpoint",
  api: "API",
  identity_system: "Identity System",
  business_process: "Business Process",
  generic: "Other",
};

export function assetTypeLabel(value: string): string {
  return isAssetType(value) ? ASSET_TYPE_LABELS[value] : value;
}

/** The asset_registry_v row projection (engine CanonicalAsset). */
export interface CanonicalAsset {
  asset_id: string;
  asset_type: AssetType;
  organization_id: string;
  name: string;
  criticality: string | null;
  owner_user_id: string | null;
  status: string;
  backing_kind: string;
  backing_id: string;
  lifecycle_status: string | null;
  created_at: string;
  updated_at: string;
}

export const ASSET_PAGE = { defaultLimit: 25, maxLimit: 100 } as const;

/**
 * Where an asset's authoritative page lives (EAR-AD-1 — the unified surface
 * never replaces per-type homes). Detail-backed kinds (Phase 3a tables) are
 * homed on the unified surface itself → /assets/[id] (EAR P6).
 */
export function assetDetailHref(
  asset: Pick<CanonicalAsset, "backing_kind" | "backing_id" | "asset_id">,
): string | null {
  switch (asset.backing_kind) {
    case "vendors":
      return `/vendors/${asset.backing_id}`;
    case "ai_systems":
      return `/ai-systems/${asset.backing_id}`;
    case "enterprise_entities":
      return `/enterprise-context/entities/${asset.backing_id}`;
    case "cloud_resources":
    case "endpoints":
    case "apis":
    case "identity_systems":
      return `/assets/${asset.asset_id}`;
    default:
      return null;
  }
}

/** Human copy for a failed assets read (mirrors enterpriseContextFormat.readFailure). */
export function assetsReadFailure(result: { disabled: boolean; error: string }): {
  kind: "disabled" | "capability" | "error";
  message: string;
} {
  if (result.disabled) {
    return {
      kind: "disabled",
      message: "The Asset Registry isn't available for your organization yet.",
    };
  }
  if (result.error === "capability_required") {
    return {
      kind: "capability",
      message: "Your organization doesn't have access to the Asset Registry.",
    };
  }
  return {
    kind: "error",
    message: "Something went wrong loading assets. Please try again.",
  };
}
