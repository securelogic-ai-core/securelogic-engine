/**
 * obligationValidation.ts — Pure validation for obligation routes.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Canonical domain values from CANONICAL_RISK_MODEL.md.
// List is non-exhaustive by design — extend here as the platform grows.
const VALID_DOMAINS = new Set([
  "Access Management",
  "Vendor Risk",
  "AI Governance",
  "Regulatory",
  "Vulnerability",
  "Resilience",
  "General"
]);

const VALID_STATUSES = new Set(["active", "waived", "not_applicable"]);
const VALID_PRIORITIES = new Set(["immediate", "near_term", "planned", "watch"]);

const TITLE_MAX_LENGTH = 500;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!DATE_RE.test(v)) return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// validateObligationCreate
// ---------------------------------------------------------------------------

export type ObligationCreateInput = {
  title: string;
  description: string | null;
  source_regulation: string | null;
  jurisdiction: string | null;
  domain: string | null;
  status: string;
  priority: string | null;
  due_date: string | null;
  owner_user_id: string | null;
  notes: string | null;
};

export type ObligationCreateResult =
  | { input: ObligationCreateInput }
  | { error: string; detail?: string };

export function validateObligationCreate(body: unknown): ObligationCreateResult {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // title — required, non-empty, max 500 chars
  if (!isNonEmptyString(b["title"])) {
    return { error: "title_required" };
  }
  const title = (b["title"] as string).trim();
  if (title.length > TITLE_MAX_LENGTH) {
    return { error: "title_too_long", detail: `max ${TITLE_MAX_LENGTH} characters` };
  }

  // status — optional, default 'active'
  let status = "active";
  if ("status" in b && b["status"] !== undefined && b["status"] !== null) {
    if (!isNonEmptyString(b["status"]) || !VALID_STATUSES.has(b["status"] as string)) {
      return {
        error: "invalid_status",
        detail: `must be one of: ${[...VALID_STATUSES].join(", ")}`
      };
    }
    status = b["status"] as string;
  }

  // priority — optional
  let priority: string | null = null;
  if ("priority" in b && b["priority"] !== null && b["priority"] !== undefined) {
    if (!isNonEmptyString(b["priority"]) || !VALID_PRIORITIES.has(b["priority"] as string)) {
      return {
        error: "invalid_priority",
        detail: `must be one of: ${[...VALID_PRIORITIES].join(", ")}`
      };
    }
    priority = b["priority"] as string;
  }

  // domain — optional, validated against canonical list
  let domain: string | null = null;
  if ("domain" in b && b["domain"] !== null && b["domain"] !== undefined) {
    if (!isNonEmptyString(b["domain"]) || !VALID_DOMAINS.has(b["domain"] as string)) {
      return {
        error: "invalid_domain",
        detail: `must be one of: ${[...VALID_DOMAINS].join(", ")}`
      };
    }
    domain = b["domain"] as string;
  }

  // due_date — optional, must be YYYY-MM-DD
  let due_date: string | null = null;
  if ("due_date" in b && b["due_date"] !== null && b["due_date"] !== undefined) {
    if (!isValidDate(b["due_date"])) {
      return { error: "invalid_due_date", detail: "must be a valid date in YYYY-MM-DD format" };
    }
    due_date = b["due_date"] as string;
  }

  // owner_user_id — optional UUID
  let owner_user_id: string | null = null;
  if ("owner_user_id" in b && b["owner_user_id"] !== null && b["owner_user_id"] !== undefined) {
    if (!isUuid(b["owner_user_id"])) {
      return { error: "owner_user_id_must_be_uuid_or_null" };
    }
    owner_user_id = b["owner_user_id"] as string;
  }

  // description — optional string
  const description =
    "description" in b && typeof b["description"] === "string" && b["description"].trim().length > 0
      ? b["description"].trim()
      : null;

  // source_regulation — optional string
  const source_regulation =
    "source_regulation" in b && typeof b["source_regulation"] === "string" && b["source_regulation"].trim().length > 0
      ? b["source_regulation"].trim()
      : null;

  // jurisdiction — optional string
  const jurisdiction =
    "jurisdiction" in b && typeof b["jurisdiction"] === "string" && b["jurisdiction"].trim().length > 0
      ? b["jurisdiction"].trim()
      : null;

  // notes — optional string
  const notes =
    "notes" in b && typeof b["notes"] === "string" && b["notes"].trim().length > 0
      ? b["notes"].trim()
      : null;

  return {
    input: {
      title,
      description,
      source_regulation,
      jurisdiction,
      domain,
      status,
      priority,
      due_date,
      owner_user_id,
      notes
    }
  };
}

// ---------------------------------------------------------------------------
// validateObligationPatch
// ---------------------------------------------------------------------------

export type ObligationPatchInput = {
  title?: string;
  description?: string | null;
  source_regulation?: string | null;
  jurisdiction?: string | null;
  domain?: string | null;
  status?: string;
  priority?: string | null;
  due_date?: string | null;
  owner_user_id?: string | null;
  notes?: string | null;
};

export type ObligationPatchResult =
  | { input: ObligationPatchInput }
  | { error: string; detail?: string };

export function validateObligationPatch(body: unknown): ObligationPatchResult {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;
  const input: ObligationPatchInput = {};

  if ("title" in b) {
    if (!isNonEmptyString(b["title"])) {
      return { error: "title_must_be_non_empty_string" };
    }
    const title = (b["title"] as string).trim();
    if (title.length > TITLE_MAX_LENGTH) {
      return { error: "title_too_long", detail: `max ${TITLE_MAX_LENGTH} characters` };
    }
    input.title = title;
  }

  if ("description" in b) {
    input.description =
      typeof b["description"] === "string" && b["description"].trim().length > 0
        ? b["description"].trim()
        : null;
  }

  if ("source_regulation" in b) {
    input.source_regulation =
      typeof b["source_regulation"] === "string" && b["source_regulation"].trim().length > 0
        ? b["source_regulation"].trim()
        : null;
  }

  if ("jurisdiction" in b) {
    input.jurisdiction =
      typeof b["jurisdiction"] === "string" && b["jurisdiction"].trim().length > 0
        ? b["jurisdiction"].trim()
        : null;
  }

  if ("domain" in b) {
    if (b["domain"] === null || b["domain"] === undefined) {
      input.domain = null;
    } else if (!isNonEmptyString(b["domain"]) || !VALID_DOMAINS.has(b["domain"] as string)) {
      return {
        error: "invalid_domain",
        detail: `must be one of: ${[...VALID_DOMAINS].join(", ")}`
      };
    } else {
      input.domain = b["domain"] as string;
    }
  }

  if ("status" in b) {
    if (!isNonEmptyString(b["status"]) || !VALID_STATUSES.has(b["status"] as string)) {
      return {
        error: "invalid_status",
        detail: `must be one of: ${[...VALID_STATUSES].join(", ")}`
      };
    }
    input.status = b["status"] as string;
  }

  if ("priority" in b) {
    if (b["priority"] === null || b["priority"] === undefined) {
      input.priority = null;
    } else if (!isNonEmptyString(b["priority"]) || !VALID_PRIORITIES.has(b["priority"] as string)) {
      return {
        error: "invalid_priority",
        detail: `must be one of: ${[...VALID_PRIORITIES].join(", ")}`
      };
    } else {
      input.priority = b["priority"] as string;
    }
  }

  if ("due_date" in b) {
    if (b["due_date"] === null || b["due_date"] === undefined) {
      input.due_date = null;
    } else if (!isValidDate(b["due_date"])) {
      return { error: "invalid_due_date", detail: "must be a valid date in YYYY-MM-DD format" };
    } else {
      input.due_date = b["due_date"] as string;
    }
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

  if ("notes" in b) {
    input.notes =
      typeof b["notes"] === "string" && b["notes"].trim().length > 0
        ? b["notes"].trim()
        : null;
  }

  if (Object.keys(input).length === 0) {
    return {
      error: "no_updateable_fields",
      detail: "updatable: title, description, source_regulation, jurisdiction, domain, status, priority, due_date, owner_user_id, notes"
    };
  }

  return { input };
}

// ---------------------------------------------------------------------------
// validateObligationMappingCreate
// ---------------------------------------------------------------------------

export type ObligationMappingCreateInput = {
  obligation_id: string;
  requirement_id: string;
};

export type ObligationMappingCreateResult =
  | { input: ObligationMappingCreateInput }
  | { error: string; detail?: string };

export function validateObligationMappingCreate(
  body: unknown
): ObligationMappingCreateResult {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b["obligation_id"])) {
    return { error: "obligation_id_required" };
  }
  if (!isUuid(b["obligation_id"])) {
    return { error: "obligation_id_must_be_uuid" };
  }
  const obligation_id = b["obligation_id"] as string;

  if (!isNonEmptyString(b["requirement_id"])) {
    return { error: "requirement_id_required" };
  }
  if (!isUuid(b["requirement_id"])) {
    return { error: "requirement_id_must_be_uuid" };
  }
  const requirement_id = b["requirement_id"] as string;

  return { input: { obligation_id, requirement_id } };
}
