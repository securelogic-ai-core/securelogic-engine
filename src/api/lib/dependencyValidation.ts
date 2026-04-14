/**
 * dependencyValidation.ts — Pure validation for dependency routes.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 *
 * Dependency_type and status are canonical enums defined for this package.
 * Criticality reuses the canonical Severity enum.
 */

// ---------------------------------------------------------------------------
// Canonical enums
// ---------------------------------------------------------------------------

export const VALID_DEPENDENCY_TYPES = new Set([
  "software_library",
  "cloud_service",
  "infrastructure",
  "api",
  "other"
]);

export const VALID_CRITICALITIES = new Set([
  "Critical",
  "High",
  "Moderate",
  "Low"
]);

export const VALID_STATUSES = new Set([
  "active",
  "deprecated",
  "under_review"
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// validateDependencyCreate — POST /api/dependencies body
// ---------------------------------------------------------------------------

export type DependencyCreateInput = {
  name: string;
  dependency_type: string;
  criticality: string;
  status: string;
  vendor_id: string | null;
  version: string | null;
  description: string | null;
  license: string | null;
  external_ref: string | null;
};

export type DependencyCreateResult =
  | { input: DependencyCreateInput }
  | { error: string; detail?: string };

export function validateDependencyCreate(body: unknown): DependencyCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // name — required non-empty string
  if (!isNonEmptyString(b["name"])) {
    return { error: "name_required" };
  }
  const name = (b["name"] as string).trim();

  // dependency_type — required enum
  if (!isNonEmptyString(b["dependency_type"])) {
    return { error: "dependency_type_required" };
  }
  if (!VALID_DEPENDENCY_TYPES.has(b["dependency_type"] as string)) {
    return {
      error: "invalid_dependency_type",
      detail: "Must be one of: software_library, cloud_service, infrastructure, api, other"
    };
  }
  const dependency_type = b["dependency_type"] as string;

  // criticality — required enum
  if (!isNonEmptyString(b["criticality"])) {
    return { error: "criticality_required" };
  }
  if (!VALID_CRITICALITIES.has(b["criticality"] as string)) {
    return {
      error: "invalid_criticality",
      detail: "Must be one of: Critical, High, Moderate, Low"
    };
  }
  const criticality = b["criticality"] as string;

  // status — optional enum, defaults to 'active'
  let status = "active";
  if ("status" in b) {
    if (!isNonEmptyString(b["status"])) {
      return { error: "status_must_be_non_empty_string" };
    }
    if (!VALID_STATUSES.has(b["status"] as string)) {
      return {
        error: "invalid_status",
        detail: "Must be one of: active, deprecated, under_review"
      };
    }
    status = b["status"] as string;
  }

  // vendor_id — optional UUID or null
  let vendor_id: string | null = null;
  if ("vendor_id" in b) {
    if (b["vendor_id"] !== null) {
      if (!isUuid(b["vendor_id"])) {
        return { error: "vendor_id_must_be_uuid_or_null" };
      }
      vendor_id = (b["vendor_id"] as string).trim();
    }
  }

  // version — optional string or null
  let version: string | null = null;
  if ("version" in b) {
    if (b["version"] !== null && typeof b["version"] !== "string") {
      return { error: "version_must_be_string_or_null" };
    }
    version =
      typeof b["version"] === "string" && b["version"].trim().length > 0
        ? b["version"].trim()
        : null;
  }

  // description — optional string or null
  let description: string | null = null;
  if ("description" in b) {
    if (b["description"] !== null && typeof b["description"] !== "string") {
      return { error: "description_must_be_string_or_null" };
    }
    description =
      typeof b["description"] === "string" && b["description"].trim().length > 0
        ? b["description"].trim()
        : null;
  }

  // license — optional string or null
  let license: string | null = null;
  if ("license" in b) {
    if (b["license"] !== null && typeof b["license"] !== "string") {
      return { error: "license_must_be_string_or_null" };
    }
    license =
      typeof b["license"] === "string" && b["license"].trim().length > 0
        ? b["license"].trim()
        : null;
  }

  // external_ref — optional string or null
  let external_ref: string | null = null;
  if ("external_ref" in b) {
    if (b["external_ref"] !== null && typeof b["external_ref"] !== "string") {
      return { error: "external_ref_must_be_string_or_null" };
    }
    external_ref =
      typeof b["external_ref"] === "string" && b["external_ref"].trim().length > 0
        ? b["external_ref"].trim()
        : null;
  }

  return {
    input: {
      name,
      dependency_type,
      criticality,
      status,
      vendor_id,
      version,
      description,
      license,
      external_ref
    }
  };
}

// ---------------------------------------------------------------------------
// validateDependencyUpdate — PATCH /api/dependencies/:id body
// ---------------------------------------------------------------------------

export type DependencyUpdateInput = {
  name: string | undefined;
  dependency_type: string | undefined;
  criticality: string | undefined;
  status: string | undefined;
  vendor_id: string | null | undefined;
  version: string | null | undefined;
  description: string | null | undefined;
  license: string | null | undefined;
  external_ref: string | null | undefined;
};

export type DependencyUpdateResult =
  | { input: DependencyUpdateInput }
  | { error: string; detail?: string };

export function validateDependencyUpdate(body: unknown): DependencyUpdateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  const KNOWN_FIELDS = new Set([
    "name", "dependency_type", "criticality", "status",
    "vendor_id", "version", "description", "license", "external_ref"
  ]);

  const hasField = [...KNOWN_FIELDS].some(f => f in b);
  if (!hasField) {
    return { error: "no_fields_to_update" };
  }

  let name: string | undefined;
  if ("name" in b) {
    if (!isNonEmptyString(b["name"])) {
      return { error: "name_must_be_non_empty_string" };
    }
    name = (b["name"] as string).trim();
  }

  let dependency_type: string | undefined;
  if ("dependency_type" in b) {
    if (!isNonEmptyString(b["dependency_type"])) {
      return { error: "dependency_type_must_be_non_empty_string" };
    }
    if (!VALID_DEPENDENCY_TYPES.has(b["dependency_type"] as string)) {
      return {
        error: "invalid_dependency_type",
        detail: "Must be one of: software_library, cloud_service, infrastructure, api, other"
      };
    }
    dependency_type = b["dependency_type"] as string;
  }

  let criticality: string | undefined;
  if ("criticality" in b) {
    if (!isNonEmptyString(b["criticality"])) {
      return { error: "criticality_must_be_non_empty_string" };
    }
    if (!VALID_CRITICALITIES.has(b["criticality"] as string)) {
      return {
        error: "invalid_criticality",
        detail: "Must be one of: Critical, High, Moderate, Low"
      };
    }
    criticality = b["criticality"] as string;
  }

  let status: string | undefined;
  if ("status" in b) {
    if (!isNonEmptyString(b["status"])) {
      return { error: "status_must_be_non_empty_string" };
    }
    if (!VALID_STATUSES.has(b["status"] as string)) {
      return {
        error: "invalid_status",
        detail: "Must be one of: active, deprecated, under_review"
      };
    }
    status = b["status"] as string;
  }

  let vendor_id: string | null | undefined;
  if ("vendor_id" in b) {
    if (b["vendor_id"] === null) {
      vendor_id = null;
    } else if (!isUuid(b["vendor_id"])) {
      return { error: "vendor_id_must_be_uuid_or_null" };
    } else {
      vendor_id = (b["vendor_id"] as string).trim();
    }
  }

  let version: string | null | undefined;
  if ("version" in b) {
    if (b["version"] !== null && typeof b["version"] !== "string") {
      return { error: "version_must_be_string_or_null" };
    }
    version =
      typeof b["version"] === "string" && b["version"].trim().length > 0
        ? b["version"].trim()
        : null;
  }

  let description: string | null | undefined;
  if ("description" in b) {
    if (b["description"] !== null && typeof b["description"] !== "string") {
      return { error: "description_must_be_string_or_null" };
    }
    description =
      typeof b["description"] === "string" && b["description"].trim().length > 0
        ? b["description"].trim()
        : null;
  }

  let license: string | null | undefined;
  if ("license" in b) {
    if (b["license"] !== null && typeof b["license"] !== "string") {
      return { error: "license_must_be_string_or_null" };
    }
    license =
      typeof b["license"] === "string" && b["license"].trim().length > 0
        ? b["license"].trim()
        : null;
  }

  let external_ref: string | null | undefined;
  if ("external_ref" in b) {
    if (b["external_ref"] !== null && typeof b["external_ref"] !== "string") {
      return { error: "external_ref_must_be_string_or_null" };
    }
    external_ref =
      typeof b["external_ref"] === "string" && b["external_ref"].trim().length > 0
        ? b["external_ref"].trim()
        : null;
  }

  return {
    input: {
      name,
      dependency_type,
      criticality,
      status,
      vendor_id,
      version,
      description,
      license,
      external_ref
    }
  };
}

// ---------------------------------------------------------------------------
// validateDependencyListQuery — GET /api/dependencies query params
// ---------------------------------------------------------------------------

export type DependencyListQueryInput = {
  status: string | null;
  dependency_type: string | null;
  vendor_id: string | null;
  limit: number;
  before_created_at: string | null;
  before_id: string | null;
};

export type DependencyListQueryResult =
  | { input: DependencyListQueryInput }
  | { error: string; detail?: string };

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export function validateDependencyListQuery(
  query: unknown
): DependencyListQueryResult {
  if (query === null || typeof query !== "object" || Array.isArray(query)) {
    return { error: "query_params_invalid" };
  }

  const q = query as Record<string, unknown>;

  // status filter — optional enum
  let status: string | null = null;
  if ("status" in q && isNonEmptyString(q["status"])) {
    if (!VALID_STATUSES.has(q["status"] as string)) {
      return {
        error: "invalid_status_filter",
        detail: "Must be one of: active, deprecated, under_review"
      };
    }
    status = q["status"] as string;
  }

  // dependency_type filter — optional enum
  let dependency_type: string | null = null;
  if ("dependency_type" in q && isNonEmptyString(q["dependency_type"])) {
    if (!VALID_DEPENDENCY_TYPES.has(q["dependency_type"] as string)) {
      return {
        error: "invalid_dependency_type_filter",
        detail: "Must be one of: software_library, cloud_service, infrastructure, api, other"
      };
    }
    dependency_type = q["dependency_type"] as string;
  }

  // vendor_id filter — optional UUID
  let vendor_id: string | null = null;
  if ("vendor_id" in q && isNonEmptyString(q["vendor_id"])) {
    if (!isUuid(q["vendor_id"])) {
      return { error: "vendor_id_must_be_uuid" };
    }
    vendor_id = q["vendor_id"] as string;
  }

  // cursor — both required together if either present
  const hasBefore = isNonEmptyString(q["before_created_at"]);
  const hasBeforeId = isNonEmptyString(q["before_id"]);
  if (hasBefore !== hasBeforeId) {
    return { error: "cursor_requires_both_before_created_at_and_before_id" };
  }

  let before_created_at: string | null = null;
  let before_id: string | null = null;

  if (hasBefore && hasBeforeId) {
    if (!isUuid(q["before_id"])) {
      return { error: "before_id_must_be_uuid" };
    }
    before_created_at = q["before_created_at"] as string;
    before_id = q["before_id"] as string;
  }

  const limit = parseLimit(q["limit"]);

  return {
    input: {
      status,
      dependency_type,
      vendor_id,
      limit,
      before_created_at,
      before_id
    }
  };
}
