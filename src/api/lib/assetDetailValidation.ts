/**
 * assetDetailValidation.ts — EAR Phase 3a: create-input validation for the
 * four detail-backed asset types (20260806 tables). Mirrors the ECL
 * validator style: closed vocabularies, bounded strings, flat error codes.
 * The unified POST /api/assets route is the only consumer; per-type routes
 * do not exist for these types (the unified surface IS their CRUD home).
 */

import type { AssetType } from "./assetRegistry.js";

const MAX_NAME = 200;
const MAX_TEXT = 200;

export const DETAIL_BACKED_TYPES = [
  "cloud_resource",
  "endpoint",
  "api",
  "identity_system"
] as const;
export type DetailBackedType = (typeof DETAIL_BACKED_TYPES)[number];

export function isDetailBackedType(v: unknown): v is DetailBackedType {
  return typeof v === "string" && (DETAIL_BACKED_TYPES as readonly string[]).includes(v);
}

const CRITICALITIES = new Set(["critical", "high", "medium", "low"]);
const STATUSES = new Set(["active", "archived", "retired"]);

/** Typed-column vocabularies — MUST match the 20260806 CHECKs (unit-asserted). */
const TYPED_VOCAB: Record<DetailBackedType, Record<string, Set<string> | "free">> = {
  cloud_resource: {
    provider: new Set(["aws", "azure", "gcp", "other"]),
    account_id: "free",
    region: "free",
    resource_type: "free"
  },
  endpoint: {
    hostname: "free",
    os: "free",
    exposure: new Set(["internal", "internet_facing", "isolated"])
  },
  api: {
    protocol: new Set(["rest", "graphql", "grpc", "soap", "other"]),
    auth_method: new Set(["none", "api_key", "oauth2", "mtls", "basic", "other"]),
    exposure: new Set(["internal", "internet_facing", "partner"])
  },
  identity_system: {
    idp_vendor: "free",
    protocol: new Set(["saml", "oidc", "ldap", "radius", "proprietary", "other"])
  }
};

/** provider is the one NOT NULL typed column (cloud_resources). */
const REQUIRED_TYPED: Partial<Record<DetailBackedType, string[]>> = {
  cloud_resource: ["provider"]
};

export type AssetDetailCreateInput = {
  asset_type: DetailBackedType;
  name: string;
  criticality: string | null;
  status: string;
  external_ref: string | null;
  typed: Record<string, string | null>;
};

export type AssetDetailCreateResult =
  | { input: AssetDetailCreateInput }
  | { error: string; detail?: string };

export function validateAssetDetailCreate(body: unknown): AssetDetailCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "invalid_body" };
  }
  const b = body as Record<string, unknown>;

  if (!isDetailBackedType(b.asset_type)) {
    return {
      error: "asset_type_invalid",
      detail: `asset_type must be one of: ${DETAIL_BACKED_TYPES.join(", ")}. ` +
        "vendor / ai_system / application / database / business_process are created on their own routes."
    };
  }
  const assetType = b.asset_type;

  if (typeof b.name !== "string" || b.name.trim().length === 0) {
    return { error: "name_required" };
  }
  const name = b.name.trim();
  if (name.length > MAX_NAME) return { error: "name_too_long" };

  let criticality: string | null = null;
  if (b.criticality !== undefined && b.criticality !== null) {
    if (typeof b.criticality !== "string" || !CRITICALITIES.has(b.criticality)) {
      return { error: "criticality_invalid" };
    }
    criticality = b.criticality;
  }

  let status = "active";
  if (b.status !== undefined && b.status !== null) {
    if (typeof b.status !== "string" || !STATUSES.has(b.status)) {
      return { error: "status_invalid" };
    }
    status = b.status;
  }

  let externalRef: string | null = null;
  if (b.external_ref !== undefined && b.external_ref !== null) {
    if (typeof b.external_ref !== "string" || b.external_ref.length > MAX_TEXT) {
      return { error: "external_ref_invalid" };
    }
    externalRef = b.external_ref;
  }

  const vocab = TYPED_VOCAB[assetType];
  const typed: Record<string, string | null> = {};
  for (const [field, allowed] of Object.entries(vocab)) {
    const raw = b[field];
    if (raw === undefined || raw === null) {
      typed[field] = null;
      continue;
    }
    if (typeof raw !== "string" || raw.length > MAX_TEXT) {
      return { error: `${field}_invalid` };
    }
    if (allowed !== "free" && !allowed.has(raw)) {
      return { error: `${field}_invalid`, detail: `${field} must be one of: ${[...allowed].join(", ")}` };
    }
    typed[field] = raw;
  }
  for (const required of REQUIRED_TYPED[assetType] ?? []) {
    if (typed[required] === null) return { error: `${required}_required` };
  }

  return { input: { asset_type: assetType, name, criticality, status, external_ref: externalRef, typed } };
}

export type AssetDetailUpdateInput = {
  /** Only the provided columns are written; every key is validated. */
  patch: Record<string, string | null>;
};

export type AssetDetailUpdateResult =
  | { input: AssetDetailUpdateInput }
  | { error: string; detail?: string };

/**
 * EAR P6: partial-update validation for a detail-backed asset. Same
 * vocabularies as create; every field optional; explicit null clears a
 * nullable column (name/status cannot be cleared). At least one known field
 * must be present.
 */
export function validateAssetDetailUpdate(
  assetType: DetailBackedType,
  body: unknown
): AssetDetailUpdateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "invalid_body" };
  }
  const b = body as Record<string, unknown>;
  const patch: Record<string, string | null> = {};

  if ("name" in b) {
    if (typeof b.name !== "string" || b.name.trim().length === 0) return { error: "name_required" };
    const name = b.name.trim();
    if (name.length > MAX_NAME) return { error: "name_too_long" };
    patch.name = name;
  }
  if ("criticality" in b) {
    if (b.criticality === null) patch.criticality = null;
    else if (typeof b.criticality === "string" && CRITICALITIES.has(b.criticality)) patch.criticality = b.criticality;
    else return { error: "criticality_invalid" };
  }
  if ("status" in b) {
    if (typeof b.status !== "string" || !STATUSES.has(b.status)) return { error: "status_invalid" };
    patch.status = b.status;
  }
  if ("external_ref" in b) {
    if (b.external_ref === null) patch.external_ref = null;
    else if (typeof b.external_ref === "string" && b.external_ref.length <= MAX_TEXT) patch.external_ref = b.external_ref;
    else return { error: "external_ref_invalid" };
  }

  const vocab = TYPED_VOCAB[assetType];
  for (const [field, allowed] of Object.entries(vocab)) {
    if (!(field in b)) continue;
    const raw = b[field];
    if (raw === null) {
      // provider is NOT NULL (cloud_resources) — cannot be cleared.
      if ((REQUIRED_TYPED[assetType] ?? []).includes(field)) return { error: `${field}_required` };
      patch[field] = null;
      continue;
    }
    if (typeof raw !== "string" || raw.length > MAX_TEXT) return { error: `${field}_invalid` };
    if (allowed !== "free" && !allowed.has(raw)) {
      return { error: `${field}_invalid`, detail: `${field} must be one of: ${[...allowed].join(", ")}` };
    }
    patch[field] = raw;
  }

  if (Object.keys(patch).length === 0) return { error: "empty_update" };
  return { input: { patch } };
}

/** Detail table + insert column order per type — closed, never caller input. */
export const DETAIL_TABLE_SPEC: Record<
  DetailBackedType,
  { table: string; typedColumns: string[]; assetType: AssetType }
> = {
  cloud_resource: {
    table: "cloud_resources",
    typedColumns: ["provider", "account_id", "region", "resource_type"],
    assetType: "cloud_resource"
  },
  endpoint: {
    table: "endpoints",
    typedColumns: ["hostname", "os", "exposure"],
    assetType: "endpoint"
  },
  api: {
    table: "apis",
    typedColumns: ["protocol", "auth_method", "exposure"],
    assetType: "api"
  },
  identity_system: {
    table: "identity_systems",
    typedColumns: ["idp_vendor", "protocol"],
    assetType: "identity_system"
  }
};
