/**
 * controlValidation.ts — Pure validation for control routes.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 */

import { sanitizeString } from "./sanitize.js";

const MAX_NAME        = 255;
const MAX_DESCRIPTION = 2000;
const MAX_FAMILY      = 255;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Canonical enums
// ---------------------------------------------------------------------------

export const VALID_CONTROL_TYPES = new Set([
  "preventive",
  "detective",
  "corrective",
  "deterrent",
  "compensating",
  "directive",
]);

export const VALID_CONTROL_STATUSES = new Set([
  "active",
  "inactive",
  "deprecated",
]);

export const VALID_DOMAINS = new Set([
  "Access Management",
  "Vendor Risk",
  "AI Governance",
  "Regulatory",
  "Vulnerability",
  "Resilience",
  "General",
]);

export const VALID_MATURITY_LEVELS = new Set([
  "initial",
  "managed",
  "defined",
  "optimizing",
  "optimized",
]);

export const VALID_IMPLEMENTATION_STATUSES = new Set([
  "not_started",
  "in_progress",
  "implemented",
  "verified",
]);

// ---------------------------------------------------------------------------
// validateControlCreate — POST /api/controls body
// ---------------------------------------------------------------------------

export type ControlCreateInput = {
  name: string;
  description: string | null;
  owner_user_id: string | null;
  control_type: string | null;
  status: string;
  domain: string | null;
  control_family: string | null;
  maturity_level: string | null;
  implementation_status: string | null;
};

export type ControlCreateResult =
  | { input: ControlCreateInput }
  | { error: string; detail?: string };

export function validateControlCreate(body: unknown): ControlCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // name — required non-empty string
  if (!isNonEmptyString(b["name"])) {
    return { error: "name_required" };
  }
  const name = sanitizeString((b["name"] as string).trim(), MAX_NAME);

  // description — optional string or null
  let description: string | null = null;
  if ("description" in b) {
    if (b["description"] !== null && typeof b["description"] !== "string") {
      return { error: "description_must_be_string_or_null" };
    }
    description =
      typeof b["description"] === "string" && b["description"].trim().length > 0
        ? sanitizeString(b["description"].trim(), MAX_DESCRIPTION)
        : null;
  }

  // owner_user_id — optional UUID or null
  let owner_user_id: string | null = null;
  if ("owner_user_id" in b) {
    if (b["owner_user_id"] !== null && b["owner_user_id"] !== undefined) {
      if (!isUuid(b["owner_user_id"])) {
        return { error: "owner_user_id_must_be_uuid_or_null" };
      }
      owner_user_id = b["owner_user_id"] as string;
    }
  }

  // control_type — optional enum or null
  let control_type: string | null = null;
  if ("control_type" in b && b["control_type"] !== null && b["control_type"] !== undefined) {
    if (!isNonEmptyString(b["control_type"]) || !VALID_CONTROL_TYPES.has(b["control_type"] as string)) {
      return {
        error: "invalid_control_type",
        detail: `Must be one of: ${[...VALID_CONTROL_TYPES].join(", ")}`,
      };
    }
    control_type = b["control_type"] as string;
  }

  // status — optional enum, defaults to 'active'
  let status = "active";
  if ("status" in b && b["status"] !== null && b["status"] !== undefined) {
    if (!isNonEmptyString(b["status"]) || !VALID_CONTROL_STATUSES.has(b["status"] as string)) {
      return {
        error: "invalid_status",
        detail: `Must be one of: ${[...VALID_CONTROL_STATUSES].join(", ")}`,
      };
    }
    status = b["status"] as string;
  }

  // domain — optional enum or null
  let domain: string | null = null;
  if ("domain" in b && b["domain"] !== null && b["domain"] !== undefined) {
    if (!isNonEmptyString(b["domain"]) || !VALID_DOMAINS.has(b["domain"] as string)) {
      return {
        error: "invalid_domain",
        detail: `Must be one of: ${[...VALID_DOMAINS].join(", ")}`,
      };
    }
    domain = b["domain"] as string;
  }

  // control_family — optional free text or null
  let control_family: string | null = null;
  if ("control_family" in b) {
    if (b["control_family"] !== null && b["control_family"] !== undefined) {
      if (typeof b["control_family"] !== "string") {
        return { error: "control_family_must_be_string_or_null" };
      }
      control_family = b["control_family"].trim().length > 0
        ? sanitizeString(b["control_family"].trim(), MAX_FAMILY)
        : null;
    }
  }

  // maturity_level — optional enum or null
  let maturity_level: string | null = null;
  if ("maturity_level" in b && b["maturity_level"] !== null && b["maturity_level"] !== undefined) {
    if (!isNonEmptyString(b["maturity_level"]) || !VALID_MATURITY_LEVELS.has(b["maturity_level"] as string)) {
      return {
        error: "invalid_maturity_level",
        detail: `Must be one of: ${[...VALID_MATURITY_LEVELS].join(", ")}`,
      };
    }
    maturity_level = b["maturity_level"] as string;
  }

  // implementation_status — optional enum or null
  let implementation_status: string | null = null;
  if ("implementation_status" in b && b["implementation_status"] !== null && b["implementation_status"] !== undefined) {
    if (!isNonEmptyString(b["implementation_status"]) || !VALID_IMPLEMENTATION_STATUSES.has(b["implementation_status"] as string)) {
      return {
        error: "invalid_implementation_status",
        detail: `Must be one of: ${[...VALID_IMPLEMENTATION_STATUSES].join(", ")}`,
      };
    }
    implementation_status = b["implementation_status"] as string;
  }

  return {
    input: {
      name,
      description,
      owner_user_id,
      control_type,
      status,
      domain,
      control_family,
      maturity_level,
      implementation_status,
    },
  };
}

// ---------------------------------------------------------------------------
// validateControlPatch — PATCH /api/controls/:id body
// ---------------------------------------------------------------------------

export type ControlPatchInput = {
  name?: string;
  description?: string | null;
  owner_user_id?: string | null;
  control_type?: string | null;
  status?: string;
  domain?: string | null;
  control_family?: string | null;
  maturity_level?: string | null;
  implementation_status?: string | null;
};

export type ControlPatchResult =
  | { input: ControlPatchInput }
  | { error: string; detail?: string };

export function validateControlPatch(body: unknown): ControlPatchResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;
  const input: ControlPatchInput = {};

  if ("name" in b) {
    if (!isNonEmptyString(b["name"])) {
      return { error: "name_must_be_non_empty_string" };
    }
    input.name = sanitizeString((b["name"] as string).trim(), MAX_NAME);
  }

  if ("description" in b) {
    if (b["description"] !== null && typeof b["description"] !== "string") {
      return { error: "description_must_be_string_or_null" };
    }
    input.description =
      typeof b["description"] === "string" && b["description"].trim().length > 0
        ? sanitizeString(b["description"].trim(), MAX_DESCRIPTION)
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

  if ("control_type" in b) {
    if (b["control_type"] === null || b["control_type"] === undefined) {
      input.control_type = null;
    } else if (!isNonEmptyString(b["control_type"]) || !VALID_CONTROL_TYPES.has(b["control_type"] as string)) {
      return {
        error: "invalid_control_type",
        detail: `Must be one of: ${[...VALID_CONTROL_TYPES].join(", ")}`,
      };
    } else {
      input.control_type = b["control_type"] as string;
    }
  }

  if ("status" in b) {
    if (!isNonEmptyString(b["status"]) || !VALID_CONTROL_STATUSES.has(b["status"] as string)) {
      return {
        error: "invalid_status",
        detail: `Must be one of: ${[...VALID_CONTROL_STATUSES].join(", ")}`,
      };
    }
    input.status = b["status"] as string;
  }

  if ("domain" in b) {
    if (b["domain"] === null || b["domain"] === undefined) {
      input.domain = null;
    } else if (!isNonEmptyString(b["domain"]) || !VALID_DOMAINS.has(b["domain"] as string)) {
      return {
        error: "invalid_domain",
        detail: `Must be one of: ${[...VALID_DOMAINS].join(", ")}`,
      };
    } else {
      input.domain = b["domain"] as string;
    }
  }

  if ("control_family" in b) {
    if (b["control_family"] === null || b["control_family"] === undefined) {
      input.control_family = null;
    } else if (typeof b["control_family"] !== "string") {
      return { error: "control_family_must_be_string_or_null" };
    } else {
      input.control_family = (b["control_family"] as string).trim().length > 0
        ? sanitizeString((b["control_family"] as string).trim(), MAX_FAMILY)
        : null;
    }
  }

  if ("maturity_level" in b) {
    if (b["maturity_level"] === null || b["maturity_level"] === undefined) {
      input.maturity_level = null;
    } else if (!isNonEmptyString(b["maturity_level"]) || !VALID_MATURITY_LEVELS.has(b["maturity_level"] as string)) {
      return {
        error: "invalid_maturity_level",
        detail: `Must be one of: ${[...VALID_MATURITY_LEVELS].join(", ")}`,
      };
    } else {
      input.maturity_level = b["maturity_level"] as string;
    }
  }

  if ("implementation_status" in b) {
    if (b["implementation_status"] === null || b["implementation_status"] === undefined) {
      input.implementation_status = null;
    } else if (!isNonEmptyString(b["implementation_status"]) || !VALID_IMPLEMENTATION_STATUSES.has(b["implementation_status"] as string)) {
      return {
        error: "invalid_implementation_status",
        detail: `Must be one of: ${[...VALID_IMPLEMENTATION_STATUSES].join(", ")}`,
      };
    } else {
      input.implementation_status = b["implementation_status"] as string;
    }
  }

  if (Object.keys(input).length === 0) {
    return {
      error: "no_updateable_fields",
      detail: "updatable: name, description, owner_user_id, control_type, status, domain, control_family, maturity_level, implementation_status",
    };
  }

  return { input };
}
