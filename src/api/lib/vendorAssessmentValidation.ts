/**
 * vendorAssessmentValidation.ts — Pure validation for vendor assessment routes.
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
// validateVendorAssessmentCreate
// ---------------------------------------------------------------------------

export type VendorAssessmentCreateInput = {
  vendor_id: string;
  assessment_type: string;
  overall_severity: string;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
};

export type VendorAssessmentCreateResult =
  | { input: VendorAssessmentCreateInput }
  | { error: string; detail?: string };

export function validateVendorAssessmentCreate(
  body: unknown
): VendorAssessmentCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // vendor_id — required UUID
  if (!isNonEmptyString(b["vendor_id"])) {
    return { error: "vendor_id_required" };
  }
  if (!isUuid(b["vendor_id"])) {
    return { error: "vendor_id_must_be_uuid" };
  }
  const vendor_id = b["vendor_id"];

  // assessment_type — required non-empty string
  if (!isNonEmptyString(b["assessment_type"])) {
    return { error: "assessment_type_required" };
  }
  const assessment_type = (b["assessment_type"] as string).trim();

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
      vendor_id,
      assessment_type,
      overall_severity,
      summary,
      notes,
      performed_at,
      reviewer_id
    }
  };
}
