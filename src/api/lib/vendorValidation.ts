/**
 * vendorValidation.ts
 *
 * Pure validation logic for the vendors API.
 * No I/O dependencies — fully unit-testable without a database.
 */

const VALID_CRITICALITIES = new Set(["critical", "high", "medium", "low"]);
const VALID_DATA_SENSITIVITIES = new Set([
  "none",
  "internal",
  "confidential",
  "restricted"
]);
const VALID_ACCESS_LEVELS = new Set([
  "none",
  "read_only",
  "read_write",
  "admin",
  "network_access"
]);
const VALID_PATCH_STATUSES = new Set(["active", "archived"]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isUuid(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

// ----------------------------------------------------------------
// Vendor Create
// ----------------------------------------------------------------

export type VendorCreateInput = {
  name: string;
  service_description: string | null;
  category: string | null;
  criticality: string | null;
  data_sensitivity: string | null;
  access_level: string | null;
  website: string | null;
  owner_user_id: string | null;
};

export type VendorCreateValidationResult =
  | { input: VendorCreateInput }
  | { error: string; detail?: string };

export function validateVendorCreate(
  body: unknown
): VendorCreateValidationResult {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b["name"])) {
    return { error: "name_required" };
  }

  if (
    "criticality" in b &&
    b["criticality"] !== null &&
    b["criticality"] !== undefined
  ) {
    if (!isNonEmptyString(b["criticality"]) || !VALID_CRITICALITIES.has(b["criticality"])) {
      return {
        error: "invalid_criticality",
        detail: `must be one of: ${[...VALID_CRITICALITIES].join(", ")}`
      };
    }
  }

  if (
    "data_sensitivity" in b &&
    b["data_sensitivity"] !== null &&
    b["data_sensitivity"] !== undefined
  ) {
    if (
      !isNonEmptyString(b["data_sensitivity"]) ||
      !VALID_DATA_SENSITIVITIES.has(b["data_sensitivity"])
    ) {
      return {
        error: "invalid_data_sensitivity",
        detail: `must be one of: ${[...VALID_DATA_SENSITIVITIES].join(", ")}`
      };
    }
  }

  if (
    "access_level" in b &&
    b["access_level"] !== null &&
    b["access_level"] !== undefined
  ) {
    if (
      !isNonEmptyString(b["access_level"]) ||
      !VALID_ACCESS_LEVELS.has(b["access_level"])
    ) {
      return {
        error: "invalid_access_level",
        detail: `must be one of: ${[...VALID_ACCESS_LEVELS].join(", ")}`
      };
    }
  }

  if (
    "owner_user_id" in b &&
    b["owner_user_id"] !== null &&
    b["owner_user_id"] !== undefined &&
    !isUuid(b["owner_user_id"])
  ) {
    return { error: "owner_user_id_must_be_uuid" };
  }

  const service_description =
    "service_description" in b
      ? typeof b["service_description"] === "string"
        ? b["service_description"]
        : null
      : null;

  const category =
    "category" in b
      ? typeof b["category"] === "string"
        ? b["category"]
        : null
      : null;

  const criticality =
    "criticality" in b && isNonEmptyString(b["criticality"]) && VALID_CRITICALITIES.has(b["criticality"])
      ? (b["criticality"] as string)
      : null;

  const data_sensitivity =
    "data_sensitivity" in b &&
    isNonEmptyString(b["data_sensitivity"]) &&
    VALID_DATA_SENSITIVITIES.has(b["data_sensitivity"])
      ? (b["data_sensitivity"] as string)
      : null;

  const access_level =
    "access_level" in b &&
    isNonEmptyString(b["access_level"]) &&
    VALID_ACCESS_LEVELS.has(b["access_level"])
      ? (b["access_level"] as string)
      : null;

  const website =
    "website" in b
      ? typeof b["website"] === "string" && b["website"].trim().length > 0
        ? b["website"].trim()
        : null
      : null;

  const owner_user_id =
    "owner_user_id" in b && isUuid(b["owner_user_id"])
      ? (b["owner_user_id"] as string)
      : null;

  return {
    input: {
      name: (b["name"] as string).trim(),
      service_description,
      category,
      criticality,
      data_sensitivity,
      access_level,
      website,
      owner_user_id
    }
  };
}

// ----------------------------------------------------------------
// Vendor Patch
// ----------------------------------------------------------------

export type VendorPatchInput = {
  name?: string;
  service_description?: string | null;
  category?: string | null;
  criticality?: string | null;
  data_sensitivity?: string | null;
  access_level?: string | null;
  website?: string | null;
  owner_user_id?: string | null;
  status?: string;
};

export type VendorPatchValidationResult =
  | { input: VendorPatchInput }
  | { error: string; detail?: string };

export function validateVendorPatch(
  body: unknown
): VendorPatchValidationResult {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;
  const input: VendorPatchInput = {};

  if ("name" in b) {
    if (!isNonEmptyString(b["name"])) {
      return { error: "name_must_be_non_empty_string" };
    }
    input.name = (b["name"] as string).trim();
  }

  if ("service_description" in b) {
    input.service_description =
      typeof b["service_description"] === "string" ? b["service_description"] : null;
  }

  if ("category" in b) {
    input.category = typeof b["category"] === "string" ? b["category"] : null;
  }

  if ("criticality" in b) {
    if (b["criticality"] === null || b["criticality"] === undefined) {
      input.criticality = null;
    } else if (!isNonEmptyString(b["criticality"]) || !VALID_CRITICALITIES.has(b["criticality"])) {
      return {
        error: "invalid_criticality",
        detail: `must be one of: ${[...VALID_CRITICALITIES].join(", ")}`
      };
    } else {
      input.criticality = b["criticality"] as string;
    }
  }

  if ("data_sensitivity" in b) {
    if (b["data_sensitivity"] === null || b["data_sensitivity"] === undefined) {
      input.data_sensitivity = null;
    } else if (
      !isNonEmptyString(b["data_sensitivity"]) ||
      !VALID_DATA_SENSITIVITIES.has(b["data_sensitivity"])
    ) {
      return {
        error: "invalid_data_sensitivity",
        detail: `must be one of: ${[...VALID_DATA_SENSITIVITIES].join(", ")}`
      };
    } else {
      input.data_sensitivity = b["data_sensitivity"] as string;
    }
  }

  if ("access_level" in b) {
    if (b["access_level"] === null || b["access_level"] === undefined) {
      input.access_level = null;
    } else if (
      !isNonEmptyString(b["access_level"]) ||
      !VALID_ACCESS_LEVELS.has(b["access_level"])
    ) {
      return {
        error: "invalid_access_level",
        detail: `must be one of: ${[...VALID_ACCESS_LEVELS].join(", ")}`
      };
    } else {
      input.access_level = b["access_level"] as string;
    }
  }

  if ("website" in b) {
    input.website =
      typeof b["website"] === "string" && b["website"].trim().length > 0
        ? b["website"].trim()
        : null;
  }

  if ("owner_user_id" in b) {
    if (b["owner_user_id"] === null || b["owner_user_id"] === undefined) {
      input.owner_user_id = null;
    } else if (!isUuid(b["owner_user_id"])) {
      return { error: "owner_user_id_must_be_uuid_or_null" };
    } else {
      input.owner_user_id = b["owner_user_id"] as string;
    }
  }

  if ("status" in b) {
    if (!isNonEmptyString(b["status"]) || !VALID_PATCH_STATUSES.has(b["status"] as string)) {
      return {
        error: "invalid_status",
        detail: `must be one of: ${[...VALID_PATCH_STATUSES].join(", ")}`
      };
    }
    input.status = b["status"] as string;
  }

  if (Object.keys(input).length === 0) {
    return {
      error: "no_updateable_fields",
      detail: "updatable: name, service_description, category, criticality, data_sensitivity, access_level, website, owner_user_id, status"
    };
  }

  return { input };
}
