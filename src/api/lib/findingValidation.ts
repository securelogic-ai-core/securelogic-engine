/**
 * findingValidation.ts — Pure validation for POST /api/findings.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 *
 * Findings can be created with any valid source_type. When source_type='risk',
 * the route verifies source_id org-ownership before insert.
 */

// ---------------------------------------------------------------------------
// Canonical enums
// ---------------------------------------------------------------------------

export const VALID_SOURCE_TYPES = new Set([
  "assessment",
  "control_test",
  "vendor_review",
  "vendor_cycle_review",
  "ai_review",
  "ai_governance_review",
  "obligation_review",
  "dependency_review",
  "signal",
  "manual",
  "risk"
]);

export const VALID_SEVERITIES = new Set([
  "Critical",
  "High",
  "Moderate",
  "Low"
]);

export const VALID_PRIORITIES = new Set([
  "immediate",
  "near_term",
  "planned",
  "watch"
]);

export const VALID_LIKELIHOODS = new Set([
  "very_high",
  "high",
  "medium",
  "low",
  "very_low"
]);

export const VALID_CONFIDENCES = new Set([
  "high",
  "medium",
  "low",
  "unverified"
]);

export const VALID_TIME_SENSITIVITIES = new Set([
  "immediate",
  "near_term",
  "planned",
  "watch"
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

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// ---------------------------------------------------------------------------
// validateFindingCreate — POST /api/findings body
// ---------------------------------------------------------------------------

export type FindingCreateInput = {
  title: string;
  severity: string;
  source_type: string;
  description: string | null;
  source_id: string | null;
  domain: string | null;
  priority: string | null;
  likelihood: string | null;
  confidence: string | null;
  time_sensitivity: string | null;
  scoring_rationale: string | null;
  owner_user_id: string | null;
  due_date: string | null;
};

export type FindingCreateResult =
  | { input: FindingCreateInput }
  | { error: string; detail?: string };

export function validateFindingCreate(body: unknown): FindingCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // title — required non-empty string
  if (!isNonEmptyString(b["title"])) {
    return { error: "title_required" };
  }
  const title = (b["title"] as string).trim();

  // severity — required enum
  if (!isNonEmptyString(b["severity"])) {
    return { error: "severity_required" };
  }
  if (!VALID_SEVERITIES.has(b["severity"] as string)) {
    return {
      error: "invalid_severity",
      detail: "Must be one of: Critical, High, Moderate, Low"
    };
  }
  const severity = b["severity"] as string;

  // source_type — required enum
  if (!isNonEmptyString(b["source_type"])) {
    return { error: "source_type_required" };
  }
  if (!VALID_SOURCE_TYPES.has(b["source_type"] as string)) {
    return {
      error: "invalid_source_type",
      detail: `Must be one of: ${[...VALID_SOURCE_TYPES].join(", ")}`
    };
  }
  const source_type = b["source_type"] as string;

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

  // source_id — optional UUID or null
  let source_id: string | null = null;
  if ("source_id" in b) {
    if (b["source_id"] !== null) {
      if (!isUuid(b["source_id"])) {
        return { error: "source_id_must_be_uuid_or_null" };
      }
      source_id = (b["source_id"] as string).trim();
    }
  }

  // domain — optional string or null
  let domain: string | null = null;
  if ("domain" in b) {
    if (b["domain"] !== null && typeof b["domain"] !== "string") {
      return { error: "domain_must_be_string_or_null" };
    }
    domain =
      typeof b["domain"] === "string" && b["domain"].trim().length > 0
        ? b["domain"].trim()
        : null;
  }

  // priority — optional enum or null
  let priority: string | null = null;
  if ("priority" in b) {
    if (b["priority"] !== null) {
      if (!isNonEmptyString(b["priority"])) {
        return { error: "priority_must_be_non_empty_string_or_null" };
      }
      if (!VALID_PRIORITIES.has(b["priority"] as string)) {
        return {
          error: "invalid_priority",
          detail: "Must be one of: immediate, near_term, planned, watch"
        };
      }
      priority = b["priority"] as string;
    }
  }

  // likelihood — optional enum or null
  let likelihood: string | null = null;
  if ("likelihood" in b) {
    if (b["likelihood"] !== null) {
      if (!isNonEmptyString(b["likelihood"])) {
        return { error: "likelihood_must_be_non_empty_string_or_null" };
      }
      if (!VALID_LIKELIHOODS.has(b["likelihood"] as string)) {
        return {
          error: "invalid_likelihood",
          detail: "Must be one of: very_high, high, medium, low, very_low"
        };
      }
      likelihood = b["likelihood"] as string;
    }
  }

  // confidence — optional enum or null
  let confidence: string | null = null;
  if ("confidence" in b) {
    if (b["confidence"] !== null) {
      if (!isNonEmptyString(b["confidence"])) {
        return { error: "confidence_must_be_non_empty_string_or_null" };
      }
      if (!VALID_CONFIDENCES.has(b["confidence"] as string)) {
        return {
          error: "invalid_confidence",
          detail: "Must be one of: high, medium, low, unverified"
        };
      }
      confidence = b["confidence"] as string;
    }
  }

  // time_sensitivity — optional enum or null
  let time_sensitivity: string | null = null;
  if ("time_sensitivity" in b) {
    if (b["time_sensitivity"] !== null) {
      if (!isNonEmptyString(b["time_sensitivity"])) {
        return { error: "time_sensitivity_must_be_non_empty_string_or_null" };
      }
      if (!VALID_TIME_SENSITIVITIES.has(b["time_sensitivity"] as string)) {
        return {
          error: "invalid_time_sensitivity",
          detail: "Must be one of: immediate, near_term, planned, watch"
        };
      }
      time_sensitivity = b["time_sensitivity"] as string;
    }
  }

  // scoring_rationale — optional string or null
  let scoring_rationale: string | null = null;
  if ("scoring_rationale" in b) {
    if (b["scoring_rationale"] !== null && typeof b["scoring_rationale"] !== "string") {
      return { error: "scoring_rationale_must_be_string_or_null" };
    }
    scoring_rationale =
      typeof b["scoring_rationale"] === "string" && b["scoring_rationale"].trim().length > 0
        ? b["scoring_rationale"].trim()
        : null;
  }

  // owner_user_id — optional UUID or null
  let owner_user_id: string | null = null;
  if ("owner_user_id" in b) {
    if (b["owner_user_id"] !== null) {
      if (!isUuid(b["owner_user_id"])) {
        return { error: "owner_user_id_must_be_uuid_or_null" };
      }
      owner_user_id = (b["owner_user_id"] as string).trim();
    }
  }

  // due_date — optional ISO date string or null
  let due_date: string | null = null;
  if ("due_date" in b) {
    if (b["due_date"] !== null) {
      if (!isIsoDate(b["due_date"])) {
        return { error: "due_date_must_be_iso_date_or_null" };
      }
      due_date = b["due_date"] as string;
    }
  }

  return {
    input: {
      title,
      severity,
      source_type,
      description,
      source_id,
      domain,
      priority,
      likelihood,
      confidence,
      time_sensitivity,
      scoring_rationale,
      owner_user_id,
      due_date
    }
  };
}
