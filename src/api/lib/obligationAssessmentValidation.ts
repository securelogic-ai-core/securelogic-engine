/**
 * obligationAssessmentValidation.ts — Pure validation for obligation assessment routes.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 */

const VALID_STATUSES = new Set([
  "not_started",
  "in_progress",
  "compliant",
  "non_compliant",
  "partially_compliant"
]);

// Statuses that trigger finding creation on first transition.
export const FINDING_STATUSES = new Set(["non_compliant", "partially_compliant"]);

const VALID_SEVERITIES = new Set(["Critical", "High", "Moderate", "Low"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// validateObligationAssessmentCreate — POST body
// ---------------------------------------------------------------------------

export type ObligationAssessmentCreateInput = {
  obligation_id: string;
  status: string;
  overall_severity: string | null;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
};

export type ObligationAssessmentCreateResult =
  | { input: ObligationAssessmentCreateInput }
  | { error: string; detail?: string };

export function validateObligationAssessmentCreate(
  body: unknown
): ObligationAssessmentCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // obligation_id — required UUID
  if (!isNonEmptyString(b["obligation_id"])) {
    return { error: "obligation_id_required" };
  }
  if (!isUuid(b["obligation_id"])) {
    return { error: "obligation_id_must_be_uuid" };
  }
  const obligation_id = b["obligation_id"];

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
          "Must be one of: not_started, in_progress, compliant, non_compliant, partially_compliant"
      };
    }
    status = b["status"] as string;
  }

  // overall_severity — optional, nullable
  let overall_severity: string | null = null;
  if ("overall_severity" in b) {
    if (b["overall_severity"] !== null) {
      if (!isNonEmptyString(b["overall_severity"])) {
        return { error: "overall_severity_must_be_string_or_null" };
      }
      if (!VALID_SEVERITIES.has(b["overall_severity"] as string)) {
        return {
          error: "invalid_overall_severity",
          detail: "Must be one of: Critical, High, Moderate, Low"
        };
      }
      overall_severity = b["overall_severity"] as string;
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
      obligation_id,
      status,
      overall_severity,
      summary,
      notes,
      performed_at,
      reviewer_id
    }
  };
}

// ---------------------------------------------------------------------------
// validateObligationAssessmentStatusTransition — PATCH body
// ---------------------------------------------------------------------------

export type ObligationAssessmentStatusTransitionInput = {
  status: string;
  overall_severity: string | null;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
};

export type ObligationAssessmentStatusTransitionResult =
  | { input: ObligationAssessmentStatusTransitionInput }
  | { error: string; detail?: string };

export function validateObligationAssessmentStatusTransition(
  body: unknown
): ObligationAssessmentStatusTransitionResult {
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
        "Must be one of: not_started, in_progress, compliant, non_compliant, partially_compliant"
    };
  }
  const status = b["status"] as string;

  // overall_severity — required when transitioning to non_compliant or partially_compliant
  let overall_severity: string | null = null;
  if (FINDING_STATUSES.has(status)) {
    if (!isNonEmptyString(b["overall_severity"])) {
      return {
        error: "overall_severity_required",
        detail:
          "overall_severity is required when status is 'non_compliant' or 'partially_compliant'"
      };
    }
    if (!VALID_SEVERITIES.has(b["overall_severity"] as string)) {
      return {
        error: "invalid_overall_severity",
        detail: "Must be one of: Critical, High, Moderate, Low"
      };
    }
    overall_severity = b["overall_severity"] as string;
  } else {
    // Optional for other statuses
    if ("overall_severity" in b && b["overall_severity"] !== null) {
      if (!isNonEmptyString(b["overall_severity"])) {
        return { error: "overall_severity_must_be_string_or_null" };
      }
      if (!VALID_SEVERITIES.has(b["overall_severity"] as string)) {
        return {
          error: "invalid_overall_severity",
          detail: "Must be one of: Critical, High, Moderate, Low"
        };
      }
      overall_severity = b["overall_severity"] as string;
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

  return { input: { status, overall_severity, summary, notes, performed_at, reviewer_id } };
}
