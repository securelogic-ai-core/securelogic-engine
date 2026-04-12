/**
 * governanceReviewValidation.ts — Pure validation for governance review routes.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 */

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
// validateGovernanceReviewCreate
// ---------------------------------------------------------------------------

export type GovernanceReviewCreateInput = {
  ai_system_id: string;
  review_type: string;
  overall_severity: string;
  summary: string | null;
  outcome: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
};

export type GovernanceReviewCreateResult =
  | { input: GovernanceReviewCreateInput }
  | { error: string; detail?: string };

export function validateGovernanceReviewCreate(
  body: unknown
): GovernanceReviewCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // ai_system_id — required UUID
  if (!isNonEmptyString(b["ai_system_id"])) {
    return { error: "ai_system_id_required" };
  }
  if (!isUuid(b["ai_system_id"])) {
    return { error: "ai_system_id_must_be_uuid" };
  }
  const ai_system_id = b["ai_system_id"];

  // review_type — required non-empty string
  if (!isNonEmptyString(b["review_type"])) {
    return { error: "review_type_required" };
  }
  const review_type = (b["review_type"] as string).trim();

  // overall_severity — required, canonical values only
  if (!isNonEmptyString(b["overall_severity"])) {
    return { error: "overall_severity_required" };
  }
  if (!VALID_SEVERITIES.has(b["overall_severity"] as string)) {
    return {
      error: "invalid_overall_severity",
      detail: "Must be one of: Critical, High, Moderate, Low"
    };
  }
  const overall_severity = b["overall_severity"] as string;

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

  // outcome — optional string or null
  let outcome: string | null = null;
  if ("outcome" in b) {
    if (b["outcome"] !== null && typeof b["outcome"] !== "string") {
      return { error: "outcome_must_be_string_or_null" };
    }
    outcome =
      typeof b["outcome"] === "string" && b["outcome"].trim().length > 0
        ? b["outcome"].trim()
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
      ai_system_id,
      review_type,
      overall_severity,
      summary,
      outcome,
      performed_at,
      reviewer_id
    }
  };
}
