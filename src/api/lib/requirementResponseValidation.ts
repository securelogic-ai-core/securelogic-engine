/**
 * requirementResponseValidation.ts — Pure validation for requirement response routes.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 */

const VALID_ASSESSMENT_TYPES = new Set(["self", "vendor"]);
const VALID_STATUSES = new Set(["pass", "fail", "partial", "not_assessed"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// validateRequirementResponseUpsert — POST /api/requirement-responses body
// ---------------------------------------------------------------------------

export type RequirementResponseUpsertInput = {
  requirement_id: string;
  assessment_type: string;
  subject_id: string;
  status: string;
  notes: string | null;
  evidence_url: string | null;
};

export type RequirementResponseUpsertResult =
  | { input: RequirementResponseUpsertInput }
  | { error: string; detail?: string };

export function validateRequirementResponseUpsert(
  body: unknown
): RequirementResponseUpsertResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // requirement_id — required UUID
  if (!isNonEmptyString(b["requirement_id"])) {
    return { error: "requirement_id_required" };
  }
  if (!isUuid(b["requirement_id"])) {
    return { error: "requirement_id_must_be_uuid" };
  }
  const requirement_id = b["requirement_id"] as string;

  // assessment_type — required, must be 'self' or 'vendor'
  if (!isNonEmptyString(b["assessment_type"])) {
    return { error: "assessment_type_required" };
  }
  if (!VALID_ASSESSMENT_TYPES.has(b["assessment_type"] as string)) {
    return {
      error: "invalid_assessment_type",
      detail: "Must be one of: self, vendor"
    };
  }
  const assessment_type = b["assessment_type"] as string;

  // subject_id — required UUID
  if (!isNonEmptyString(b["subject_id"])) {
    return { error: "subject_id_required" };
  }
  if (!isUuid(b["subject_id"])) {
    return { error: "subject_id_must_be_uuid" };
  }
  const subject_id = b["subject_id"] as string;

  // status — required, must be one of the valid values
  if (!isNonEmptyString(b["status"])) {
    return { error: "status_required" };
  }
  if (!VALID_STATUSES.has(b["status"] as string)) {
    return {
      error: "invalid_status",
      detail: "Must be one of: pass, fail, partial, not_assessed"
    };
  }
  const status = b["status"] as string;

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

  // evidence_url — optional string or null
  let evidence_url: string | null = null;
  if ("evidence_url" in b) {
    if (b["evidence_url"] !== null && typeof b["evidence_url"] !== "string") {
      return { error: "evidence_url_must_be_string_or_null" };
    }
    evidence_url =
      typeof b["evidence_url"] === "string" && b["evidence_url"].trim().length > 0
        ? b["evidence_url"].trim()
        : null;
  }

  return {
    input: {
      requirement_id,
      assessment_type,
      subject_id,
      status,
      notes,
      evidence_url
    }
  };
}
