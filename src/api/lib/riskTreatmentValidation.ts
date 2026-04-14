/**
 * riskTreatmentValidation.ts — Pure validation for risk treatment routes.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 */

const VALID_STATUSES = new Set([
  "not_started",
  "in_progress",
  "mitigated",
  "accepted",
  "transferred"
]);

// Terminal statuses — PATCH to these syncs the parent risk's status.
export const TERMINAL_STATUSES = new Set(["mitigated", "accepted", "transferred"]);

const VALID_TREATMENT_TYPES = new Set([
  "mitigate",
  "accept",
  "transfer",
  "avoid"
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// validateRiskTreatmentCreate — POST /api/risk-treatments body
// ---------------------------------------------------------------------------

export type RiskTreatmentCreateInput = {
  risk_id: string;
  status: string;
  treatment_type: string | null;
  owner: string | null;
  due_date: string | null;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
};

export type RiskTreatmentCreateResult =
  | { input: RiskTreatmentCreateInput }
  | { error: string; detail?: string };

export function validateRiskTreatmentCreate(
  body: unknown
): RiskTreatmentCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // risk_id — required UUID
  if (!isNonEmptyString(b["risk_id"])) {
    return { error: "risk_id_required" };
  }
  if (!isUuid(b["risk_id"])) {
    return { error: "risk_id_must_be_uuid" };
  }
  const risk_id = b["risk_id"] as string;

  // status — optional, defaults to 'not_started'
  let status = "not_started";
  if ("status" in b) {
    if (!isNonEmptyString(b["status"])) {
      return { error: "status_must_be_non_empty_string" };
    }
    if (!VALID_STATUSES.has(b["status"] as string)) {
      return {
        error: "invalid_status",
        detail:
          "Must be one of: not_started, in_progress, mitigated, accepted, transferred"
      };
    }
    status = b["status"] as string;
  }

  // treatment_type — optional enum or null
  let treatment_type: string | null = null;
  if ("treatment_type" in b) {
    if (b["treatment_type"] !== null) {
      if (!isNonEmptyString(b["treatment_type"])) {
        return { error: "treatment_type_must_be_string_or_null" };
      }
      if (!VALID_TREATMENT_TYPES.has(b["treatment_type"] as string)) {
        return {
          error: "invalid_treatment_type",
          detail: "Must be one of: mitigate, accept, transfer, avoid"
        };
      }
      treatment_type = b["treatment_type"] as string;
    }
  }

  // owner — optional string or null
  let owner: string | null = null;
  if ("owner" in b) {
    if (b["owner"] !== null && typeof b["owner"] !== "string") {
      return { error: "owner_must_be_string_or_null" };
    }
    owner =
      typeof b["owner"] === "string" && b["owner"].trim().length > 0
        ? b["owner"].trim()
        : null;
  }

  // due_date — optional ISO date string (YYYY-MM-DD) or null
  let due_date: string | null = null;
  if ("due_date" in b) {
    if (b["due_date"] !== null) {
      if (typeof b["due_date"] !== "string") {
        return { error: "due_date_must_be_date_string_or_null" };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b["due_date"])) {
        return {
          error: "due_date_invalid_format",
          detail: "Must be ISO date string: YYYY-MM-DD"
        };
      }
      due_date = b["due_date"];
    }
  }

  // summary — optional string or null
  let summary: string | null = null;
  if ("summary" in b) {
    if (b["summary"] !== null && typeof b["summary"] !== "string") {
      return { error: "summary_must_be_string_or_null" };
    }
    summary =
      typeof b["summary"] === "string" && b["summary"].trim().length > 0
        ? b["summary"].trim()
        : null;
  }

  // notes — optional string or null
  let notes: string | null = null;
  if ("notes" in b) {
    if (b["notes"] !== null && typeof b["notes"] !== "string") {
      return { error: "notes_must_be_string_or_null" };
    }
    notes =
      typeof b["notes"] === "string" && b["notes"].trim().length > 0
        ? b["notes"].trim()
        : null;
  }

  // performed_at — optional ISO date string (YYYY-MM-DD) or null
  let performed_at: string | null = null;
  if ("performed_at" in b) {
    if (b["performed_at"] !== null) {
      if (typeof b["performed_at"] !== "string") {
        return { error: "performed_at_must_be_date_string_or_null" };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b["performed_at"])) {
        return {
          error: "performed_at_invalid_format",
          detail: "Must be ISO date string: YYYY-MM-DD"
        };
      }
      performed_at = b["performed_at"];
    }
  }

  // reviewer_id — optional UUID or null
  let reviewer_id: string | null = null;
  if ("reviewer_id" in b) {
    if (b["reviewer_id"] !== null) {
      if (!isUuid(b["reviewer_id"])) {
        return { error: "reviewer_id_must_be_uuid_or_null" };
      }
      reviewer_id = b["reviewer_id"] as string;
    }
  }

  return {
    input: {
      risk_id,
      status,
      treatment_type,
      owner,
      due_date,
      summary,
      notes,
      performed_at,
      reviewer_id
    }
  };
}

// ---------------------------------------------------------------------------
// validateRiskTreatmentStatusTransition — PATCH body
// ---------------------------------------------------------------------------

export type RiskTreatmentStatusTransitionInput = {
  status: string;
  treatment_type: string | null | undefined;
  owner: string | null;
  due_date: string | null;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
};

export type RiskTreatmentStatusTransitionResult =
  | { input: RiskTreatmentStatusTransitionInput }
  | { error: string; detail?: string };

export function validateRiskTreatmentStatusTransition(
  body: unknown
): RiskTreatmentStatusTransitionResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // status — required
  if (!isNonEmptyString(b["status"])) {
    return { error: "status_required" };
  }
  if (!VALID_STATUSES.has(b["status"] as string)) {
    return {
      error: "invalid_status",
      detail:
        "Must be one of: not_started, in_progress, mitigated, accepted, transferred"
    };
  }
  const status = b["status"] as string;

  // treatment_type — optional enum or null (may be set on PATCH)
  let treatment_type: string | null | undefined;
  if ("treatment_type" in b) {
    if (b["treatment_type"] !== null) {
      if (!isNonEmptyString(b["treatment_type"])) {
        return { error: "treatment_type_must_be_string_or_null" };
      }
      if (!VALID_TREATMENT_TYPES.has(b["treatment_type"] as string)) {
        return {
          error: "invalid_treatment_type",
          detail: "Must be one of: mitigate, accept, transfer, avoid"
        };
      }
      treatment_type = b["treatment_type"] as string;
    } else {
      treatment_type = null;
    }
  }

  // owner — optional string or null
  let owner: string | null = null;
  if ("owner" in b) {
    if (b["owner"] !== null && typeof b["owner"] !== "string") {
      return { error: "owner_must_be_string_or_null" };
    }
    owner =
      typeof b["owner"] === "string" && b["owner"].trim().length > 0
        ? b["owner"].trim()
        : null;
  }

  // due_date — optional ISO date string (YYYY-MM-DD) or null
  let due_date: string | null = null;
  if ("due_date" in b) {
    if (b["due_date"] !== null) {
      if (typeof b["due_date"] !== "string") {
        return { error: "due_date_must_be_date_string_or_null" };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b["due_date"])) {
        return {
          error: "due_date_invalid_format",
          detail: "Must be ISO date string: YYYY-MM-DD"
        };
      }
      due_date = b["due_date"];
    }
  }

  // summary — optional string or null
  let summary: string | null = null;
  if ("summary" in b) {
    if (b["summary"] !== null && typeof b["summary"] !== "string") {
      return { error: "summary_must_be_string_or_null" };
    }
    summary =
      typeof b["summary"] === "string" && b["summary"].trim().length > 0
        ? b["summary"].trim()
        : null;
  }

  // notes — optional string or null
  let notes: string | null = null;
  if ("notes" in b) {
    if (b["notes"] !== null && typeof b["notes"] !== "string") {
      return { error: "notes_must_be_string_or_null" };
    }
    notes =
      typeof b["notes"] === "string" && b["notes"].trim().length > 0
        ? b["notes"].trim()
        : null;
  }

  // performed_at — optional ISO date string (YYYY-MM-DD) or null
  let performed_at: string | null = null;
  if ("performed_at" in b) {
    if (b["performed_at"] !== null) {
      if (typeof b["performed_at"] !== "string") {
        return { error: "performed_at_must_be_date_string_or_null" };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b["performed_at"])) {
        return {
          error: "performed_at_invalid_format",
          detail: "Must be ISO date string: YYYY-MM-DD"
        };
      }
      performed_at = b["performed_at"];
    }
  }

  // reviewer_id — optional UUID or null
  let reviewer_id: string | null = null;
  if ("reviewer_id" in b) {
    if (b["reviewer_id"] !== null) {
      if (!isUuid(b["reviewer_id"])) {
        return { error: "reviewer_id_must_be_uuid_or_null" };
      }
      reviewer_id = b["reviewer_id"] as string;
    }
  }

  return {
    input: {
      status,
      treatment_type,
      owner,
      due_date,
      summary,
      notes,
      performed_at,
      reviewer_id
    }
  };
}
