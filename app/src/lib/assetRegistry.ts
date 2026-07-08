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

// ─── EAR management UI (create / edit / delete) ─────────────────────────────
//
// The unified surface is the CRUD *home* for the four detail-backed types only
// (mirrors the engine's assetDetailValidation.DETAIL_BACKED_TYPES). Every other
// type is created/edited on its own authoritative surface — this module encodes
// the federated routing (EAR-AD-1) so the /assets management shell never
// duplicates a per-type form.

export const DETAIL_BACKED_TYPES = [
  "cloud_resource",
  "endpoint",
  "api",
  "identity_system",
] as const;
export type DetailBackedType = (typeof DETAIL_BACKED_TYPES)[number];

export function isDetailBackedType(v: unknown): v is DetailBackedType {
  return typeof v === "string" && (DETAIL_BACKED_TYPES as readonly string[]).includes(v);
}

/** Criticality / status vocabularies — MUST match the engine validator + 20260806 CHECKs. */
export const ASSET_CRITICALITIES = ["critical", "high", "medium", "low"] as const;
export const ASSET_STATUSES = ["active", "archived", "retired"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * Typed-column spec per detail-backed type — mirrors the engine's TYPED_VOCAB
 * and REQUIRED_TYPED (src/api/lib/assetDetailValidation.ts). `options: null`
 * means a free-text field; a non-null tuple is a closed enum. The forms render
 * straight from this, so the UI can never offer a value the engine rejects.
 */
export interface TypedFieldSpec {
  field: string;
  label: string;
  required?: boolean;
  options: readonly string[] | null;
}

export const DETAIL_TYPE_FIELDS: Record<DetailBackedType, readonly TypedFieldSpec[]> = {
  cloud_resource: [
    { field: "provider", label: "Provider", required: true, options: ["aws", "azure", "gcp", "other"] },
    { field: "account_id", label: "Account ID", options: null },
    { field: "region", label: "Region", options: null },
    { field: "resource_type", label: "Resource Type", options: null },
  ],
  endpoint: [
    { field: "hostname", label: "Hostname", options: null },
    { field: "os", label: "Operating System", options: null },
    { field: "exposure", label: "Exposure", options: ["internal", "internet_facing", "isolated"] },
  ],
  api: [
    { field: "protocol", label: "Protocol", options: ["rest", "graphql", "grpc", "soap", "other"] },
    { field: "auth_method", label: "Auth Method", options: ["none", "api_key", "oauth2", "mtls", "basic", "other"] },
    { field: "exposure", label: "Exposure", options: ["internal", "internet_facing", "partner"] },
  ],
  identity_system: [
    { field: "idp_vendor", label: "IdP Vendor", options: null },
    { field: "protocol", label: "Protocol", options: ["saml", "oidc", "ldap", "radius", "proprietary", "other"] },
  ],
};

/**
 * Where a NEW asset of a given type is created (EAR-AD-1 federation).
 *   native   → the unified /assets create form (the four detail-backed types).
 *   external → an authoritative per-type surface; `requiresEcl` marks the ones
 *              homed on the Enterprise Context surface (dark behind the ECL flag).
 */
export type AssetCreateTarget =
  | { kind: "native"; assetType: DetailBackedType }
  | { kind: "external"; assetType: AssetType; href: string; requiresEcl: boolean };

export function assetCreateTarget(assetType: AssetType): AssetCreateTarget {
  if (isDetailBackedType(assetType)) return { kind: "native", assetType };
  switch (assetType) {
    case "vendor":
      return { kind: "external", assetType, href: "/vendors/new", requiresEcl: false };
    case "ai_system":
      return { kind: "external", assetType, href: "/ai-systems/new", requiresEcl: false };
    // application / database / business_process / generic project from ECL
    // enterprise_entities — created on the Context surface.
    default:
      return { kind: "external", assetType, href: "/enterprise-context/entities/new", requiresEcl: true };
  }
}

/**
 * The enterprise_entities `entity_type` that backs a registry asset_type on the
 * ECL surface — the inverse of the engine's ENTITY_TYPE_TO_ASSET_TYPE. Only the
 * three ECL-backed types preselect a specific entity_type; `generic` returns
 * null so the Add-Entity form keeps its full type picker (the one case where the
 * user is explicitly creating a generic/custom entity).
 */
export function assetTypeToEntityType(assetType: AssetType): string | null {
  switch (assetType) {
    case "application":
      return "application";
    case "database":
      return "data_store";
    case "business_process":
      return "business_process";
    default:
      return null;
  }
}

/**
 * The canonical create URL for an asset_type — the single entry that makes the
 * registry "choose the type once, land on the right Create screen" with the type
 * preselected (no repeated selection). Federation is unchanged (EAR-AD-1):
 *   - detail-backed types → the native inline form on the unified surface;
 *   - vendor / ai_system  → their dedicated screens, framed as a registry flow
 *                           (?from=registry swaps the breadcrumb back to Assets);
 *   - application / database / business_process → Add-Entity with entity_type +
 *                           asset_type preselected and locked;
 *   - generic             → Add-Entity with its full picker (explicit
 *                           generic/custom creation).
 */
export function assetCreateHref(assetType: AssetType): string {
  if (isDetailBackedType(assetType)) return `/assets/new?type=${assetType}`;
  if (assetType === "vendor") return "/vendors/new?from=registry";
  if (assetType === "ai_system") return "/ai-systems/new?from=registry";
  const entityType = assetTypeToEntityType(assetType);
  if (entityType) {
    const q = new URLSearchParams({ entity_type: entityType, asset_type: assetType });
    return `/enterprise-context/entities/new?${q.toString()}`;
  }
  return "/enterprise-context/entities/new";
}

/** Existing CSV importers the registry can hand off to (no unified import API exists). */
export interface AssetImportSurface {
  label: string;
  href: string;
  requiresEcl: boolean;
}

export function assetImportSurfaces(): AssetImportSurface[] {
  return [
    { label: "Vendors", href: "/vendors/import", requiresEcl: false },
    { label: "AI Systems", href: "/ai-systems/import", requiresEcl: false },
    { label: "Applications & data stores", href: "/enterprise-context/import", requiresEcl: true },
  ];
}

/**
 * The three canonical onboarding methods the Asset Registry create surface
 * MUST expose (EAR P15). Each reuses an existing flow — no duplicate importer or
 * connector logic:
 *   - create  → pick a type + fill the per-type form (federated, EAR-AD-1).
 *   - import  → the existing CSV/XLSX importers (assetImportSurfaces): preview,
 *               validation, de-duplication, row-level errors, and plan caps are
 *               all handled by those surfaces — nothing re-implemented here.
 *   - connect → the existing /assets/connect connector catalog (EAR Phase 3b).
 * SOC upload is deliberately NOT a method here — it stays under Vendor Management.
 */
export type AssetOnboardingKey = "create" | "import" | "connect";
export interface AssetOnboardingMethod {
  key: AssetOnboardingKey;
  title: string;
  description: string;
  /** The connect method's fixed destination; create/import fan out in-surface. */
  href: string | null;
}

export function assetOnboardingMethods(): AssetOnboardingMethod[] {
  return [
    {
      key: "create",
      title: "Create manually",
      description: "Add a single asset by choosing its type and filling in its details.",
      href: null,
    },
    {
      key: "import",
      title: "Bulk upload",
      description:
        "Import many assets at once from a CSV or XLSX file — with preview, validation, de-duplication, row-level errors, and plan caps.",
      href: null,
    },
    {
      key: "connect",
      title: "Connect enterprise systems",
      description:
        "Auto-discover assets from your CMDB, cloud, vulnerability, identity, or endpoint systems.",
      href: "/assets/connect",
    },
  ];
}

/** Edit route for a registry asset (only detail-backed kinds have one). */
export function assetEditHref(asset: Pick<CanonicalAsset, "asset_id" | "asset_type">): string | null {
  return isDetailBackedType(asset.asset_type) ? `/assets/${asset.asset_id}/edit` : null;
}

/**
 * The graph node identity for an asset (mirrors the engine's graphNodeForBacking,
 * EAR-AD-4). Used to deep-link an asset into the enterprise graph / relationship
 * surface. Detail-backed kinds are Tier-0 `asset` nodes keyed by registry id;
 * the three pre-registry backings key by their own node type + backing id.
 */
export function assetGraphNode(
  asset: Pick<CanonicalAsset, "backing_kind" | "backing_id" | "asset_id">,
): { node_type: "vendor" | "ai_system" | "enterprise_entity" | "asset"; node_id: string } {
  switch (asset.backing_kind) {
    case "vendors":
      return { node_type: "vendor", node_id: asset.backing_id };
    case "ai_systems":
      return { node_type: "ai_system", node_id: asset.backing_id };
    case "enterprise_entities":
      return { node_type: "enterprise_entity", node_id: asset.backing_id };
    default:
      return { node_type: "asset", node_id: asset.asset_id };
  }
}

/** Deep-link to view an asset's relationships in the enterprise graph. */
export function assetGraphHref(
  asset: Pick<CanonicalAsset, "backing_kind" | "backing_id" | "asset_id">,
): string {
  const n = assetGraphNode(asset);
  return `/enterprise-context/graph?node_type=${n.node_type}&node_id=${encodeURIComponent(n.node_id)}`;
}

/** Human copy for a management (write) engine error code. Never leak a raw code. */
const ASSET_ERROR_MESSAGES: Record<string, string> = {
  // gating
  capability_required: "The Asset Registry isn't enabled for your organization.",
  organization_context_missing: "Your session is missing organization context. Sign in again.",
  not_authenticated: "You're not signed in.",
  // create / validation
  invalid_body: "That request was malformed. Try again.",
  asset_type_invalid: "That asset type can't be created here — use its own screen.",
  name_required: "Name is required.",
  name_too_long: "Name is too long (max 200 characters).",
  criticality_invalid: "Choose a valid criticality.",
  status_invalid: "Choose a valid status.",
  external_ref_invalid: "External reference is too long (max 200 characters).",
  provider_required: "Provider is required for a cloud resource.",
  asset_cap_exceeded: "You've reached your plan's limit for assets of this type.",
  // update / delete
  not_detail_backed:
    "This asset is managed on its own screen (Vendors, AI Systems, or Enterprise Context).",
  empty_update: "No changes to save.",
  not_found: "That asset no longer exists.",
  invalid_id: "That asset reference is invalid.",
  // transport
  engine_unavailable: "The service is temporarily unavailable. Try again.",
  network_error: "Couldn't reach the server. Try again.",
  invalid_json: "The server returned an unexpected response.",
};

export function assetErrorMessage(code: string): string {
  // Typed-field failures come back as `${field}_invalid` (e.g. protocol_invalid).
  if (ASSET_ERROR_MESSAGES[code]) return ASSET_ERROR_MESSAGES[code];
  if (code.endsWith("_invalid")) return "One of the fields has an invalid value.";
  if (code.endsWith("_required")) return "A required field is missing.";
  return "Something went wrong. Try again.";
}
