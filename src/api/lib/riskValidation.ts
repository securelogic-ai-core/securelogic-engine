/**
 * riskValidation.ts — Pure validation for risk register routes.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 *
 * Likelihood and status are canonical enums defined for this package.
 * Impact and risk_rating reuse the canonical Severity enum.
 * Domain is a required non-empty string — not enum-gated. The canonical
 * model declares domain non-exhaustive; new values are added there without
 * requiring a code change here. VALID_DOMAINS is exported as a reference
 * of known values only.
 */

import { sanitizeString } from "./sanitize.js";

// ---------------------------------------------------------------------------
// Field length caps (application-layer, defence-in-depth)
// ---------------------------------------------------------------------------

const MAX_TITLE = 255;
const MAX_DESCRIPTION = 2000;
const MAX_DOMAIN = 100;
const MAX_TREATMENT = 2000;
const MAX_OWNER = 100;

// ---------------------------------------------------------------------------
// Canonical enums
// ---------------------------------------------------------------------------

export const VALID_LIKELIHOODS = new Set([
  "very_likely",
  "likely",
  "possible",
  "unlikely",
  "rare"
]);

export const VALID_IMPACTS = new Set([
  "Critical",
  "High",
  "Moderate",
  "Low"
]);

export const VALID_RISK_RATINGS = new Set([
  "Critical",
  "High",
  "Moderate",
  "Low"
]);

// Aliases for the new inherent / residual fields. Same value sets as
// the legacy fields above; named separately so per-field validation
// errors and downstream readers reference the correct dimension.
//
// Inherent  = pre-controls / worst-case assessment.
// Residual  = post-controls / current-state assessment.
//
// The legacy `likelihood` / `impact` / `risk_rating` fields above stay
// in place; the API writes legacy = residual on every write so the
// risk_rating field on webhook payloads stays in sync. See the package
// migration `20260506_risk_inherent_residual.sql`.
export const VALID_INHERENT_LIKELIHOODS = VALID_LIKELIHOODS;
export const VALID_INHERENT_IMPACTS     = VALID_IMPACTS;
export const VALID_INHERENT_RATINGS     = VALID_RISK_RATINGS;
export const VALID_RESIDUAL_LIKELIHOODS = VALID_LIKELIHOODS;
export const VALID_RESIDUAL_IMPACTS     = VALID_IMPACTS;
export const VALID_RESIDUAL_RATINGS     = VALID_RISK_RATINGS;

export const VALID_STATUSES = new Set([
  "open",
  "accepted",
  "mitigated",
  "closed",
  "transferred"
]);

// Canonical domains — non-exhaustive, may be extended.
export const VALID_DOMAINS = new Set([
  "Access Management",
  "Vendor Risk",
  "AI Governance",
  "Regulatory",
  "Vulnerability",
  "Resilience",
  "General"
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// validateRiskCreate — POST /api/risks body
// ---------------------------------------------------------------------------

export type RiskCreateInput = {
  title: string;
  description: string | null;
  domain: string;
  // Legacy single-rating dimension. Required at create — kept for
  // backwards compatibility with the webhook payload contract. The
  // Phase 2 POST handler writes legacy = residual on insert; for now
  // the API caller still sends the legacy values explicitly.
  likelihood: string;
  impact: string;
  risk_rating: string;
  // Inherent (pre-controls) — required at create per Decision §6.
  inherent_likelihood: string;
  inherent_impact: string;
  inherent_rating: string;
  // Residual (post-controls) — required at create per Decision §6.
  residual_likelihood: string;
  residual_impact: string;
  residual_rating: string;
  status: string;
  treatment: string | null;
  owner: string | null;
  owner_user_id: string | null;
  due_date: string | null;
  source_type: string | null;
  source_id: string | null;
};

export type RiskCreateResult =
  | { input: RiskCreateInput }
  | { error: string; detail?: string };

export function validateRiskCreate(body: unknown): RiskCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // title — required non-empty string
  if (!isNonEmptyString(b["title"])) {
    return { error: "title_required" };
  }
  const title = sanitizeString((b["title"] as string).trim(), MAX_TITLE);

  // domain — required non-empty string; not enum-gated (non-exhaustive per canonical model)
  if (!isNonEmptyString(b["domain"])) {
    return { error: "domain_required" };
  }
  const domain = sanitizeString((b["domain"] as string).trim(), MAX_DOMAIN);

  // likelihood — required enum
  if (!isNonEmptyString(b["likelihood"])) {
    return { error: "likelihood_required" };
  }
  if (!VALID_LIKELIHOODS.has(b["likelihood"] as string)) {
    return {
      error: "invalid_likelihood",
      detail: "Must be one of: very_likely, likely, possible, unlikely, rare"
    };
  }
  const likelihood = b["likelihood"] as string;

  // impact — required enum (Severity)
  if (!isNonEmptyString(b["impact"])) {
    return { error: "impact_required" };
  }
  if (!VALID_IMPACTS.has(b["impact"] as string)) {
    return {
      error: "invalid_impact",
      detail: "Must be one of: Critical, High, Moderate, Low"
    };
  }
  const impact = b["impact"] as string;

  // risk_rating — required enum (Severity)
  if (!isNonEmptyString(b["risk_rating"])) {
    return { error: "risk_rating_required" };
  }
  if (!VALID_RISK_RATINGS.has(b["risk_rating"] as string)) {
    return {
      error: "invalid_risk_rating",
      detail: "Must be one of: Critical, High, Moderate, Low"
    };
  }
  const risk_rating = b["risk_rating"] as string;

  // ─── Inherent (pre-controls) — required enum trio per Decision §6
  if (!isNonEmptyString(b["inherent_likelihood"])) {
    return { error: "inherent_likelihood_required" };
  }
  if (!VALID_INHERENT_LIKELIHOODS.has(b["inherent_likelihood"] as string)) {
    return {
      error: "invalid_inherent_likelihood",
      detail: "Must be one of: very_likely, likely, possible, unlikely, rare"
    };
  }
  const inherent_likelihood = b["inherent_likelihood"] as string;

  if (!isNonEmptyString(b["inherent_impact"])) {
    return { error: "inherent_impact_required" };
  }
  if (!VALID_INHERENT_IMPACTS.has(b["inherent_impact"] as string)) {
    return {
      error: "invalid_inherent_impact",
      detail: "Must be one of: Critical, High, Moderate, Low"
    };
  }
  const inherent_impact = b["inherent_impact"] as string;

  if (!isNonEmptyString(b["inherent_rating"])) {
    return { error: "inherent_rating_required" };
  }
  if (!VALID_INHERENT_RATINGS.has(b["inherent_rating"] as string)) {
    return {
      error: "invalid_inherent_rating",
      detail: "Must be one of: Critical, High, Moderate, Low"
    };
  }
  const inherent_rating = b["inherent_rating"] as string;

  // ─── Residual (post-controls) — required enum trio per Decision §6
  if (!isNonEmptyString(b["residual_likelihood"])) {
    return { error: "residual_likelihood_required" };
  }
  if (!VALID_RESIDUAL_LIKELIHOODS.has(b["residual_likelihood"] as string)) {
    return {
      error: "invalid_residual_likelihood",
      detail: "Must be one of: very_likely, likely, possible, unlikely, rare"
    };
  }
  const residual_likelihood = b["residual_likelihood"] as string;

  if (!isNonEmptyString(b["residual_impact"])) {
    return { error: "residual_impact_required" };
  }
  if (!VALID_RESIDUAL_IMPACTS.has(b["residual_impact"] as string)) {
    return {
      error: "invalid_residual_impact",
      detail: "Must be one of: Critical, High, Moderate, Low"
    };
  }
  const residual_impact = b["residual_impact"] as string;

  if (!isNonEmptyString(b["residual_rating"])) {
    return { error: "residual_rating_required" };
  }
  if (!VALID_RESIDUAL_RATINGS.has(b["residual_rating"] as string)) {
    return {
      error: "invalid_residual_rating",
      detail: "Must be one of: Critical, High, Moderate, Low"
    };
  }
  const residual_rating = b["residual_rating"] as string;

  // status — optional enum, defaults to 'open'
  let status = "open";
  if ("status" in b) {
    if (!isNonEmptyString(b["status"])) {
      return { error: "status_must_be_non_empty_string" };
    }
    if (!VALID_STATUSES.has(b["status"] as string)) {
      return {
        error: "invalid_status",
        detail: "Must be one of: open, accepted, mitigated, closed, transferred"
      };
    }
    status = b["status"] as string;
  }

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

  // treatment — optional string or null
  let treatment: string | null = null;
  if ("treatment" in b) {
    if (b["treatment"] !== null && typeof b["treatment"] !== "string") {
      return { error: "treatment_must_be_string_or_null" };
    }
    treatment =
      typeof b["treatment"] === "string" && b["treatment"].trim().length > 0
        ? sanitizeString(b["treatment"].trim(), MAX_TREATMENT)
        : null;
  }

  // owner — optional string or null
  let owner: string | null = null;
  if ("owner" in b) {
    if (b["owner"] !== null && typeof b["owner"] !== "string") {
      return { error: "owner_must_be_string_or_null" };
    }
    owner =
      typeof b["owner"] === "string" && b["owner"].trim().length > 0
        ? sanitizeString(b["owner"].trim(), MAX_OWNER)
        : null;
  }

  // owner_user_id — optional UUID or null. Same-org membership is
  // verified in the route handler (validators are pure / I/O-free).
  let owner_user_id: string | null = null;
  if ("owner_user_id" in b) {
    if (b["owner_user_id"] !== null) {
      if (!isUuid(b["owner_user_id"])) {
        return { error: "owner_user_id_must_be_uuid_or_null" };
      }
      owner_user_id = b["owner_user_id"] as string;
    }
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

  // source_type and source_id — must be provided together or not at all
  const hasSourceType = "source_type" in b && b["source_type"] !== null;
  const hasSourceId = "source_id" in b && b["source_id"] !== null;

  if (hasSourceType !== hasSourceId) {
    return {
      error: "source_type_and_source_id_must_be_provided_together",
      detail: "Both source_type and source_id are required when either is present"
    };
  }

  let source_type: string | null = null;
  let source_id: string | null = null;

  if (hasSourceType && hasSourceId) {
    if (!isNonEmptyString(b["source_type"])) {
      return { error: "source_type_must_be_non_empty_string" };
    }
    if (!isUuid(b["source_id"])) {
      return { error: "source_id_must_be_uuid" };
    }
    source_type = (b["source_type"] as string).trim();
    source_id = b["source_id"] as string;
  }

  return {
    input: {
      title,
      description,
      domain,
      likelihood,
      impact,
      risk_rating,
      inherent_likelihood,
      inherent_impact,
      inherent_rating,
      residual_likelihood,
      residual_impact,
      residual_rating,
      status,
      treatment,
      owner,
      owner_user_id,
      due_date,
      source_type,
      source_id
    }
  };
}

// ---------------------------------------------------------------------------
// validateRiskUpdate — PATCH /api/risks/:id body
// ---------------------------------------------------------------------------

export type RiskUpdateInput = {
  title: string | undefined;
  description: string | null | undefined;
  domain: string | undefined;
  // Legacy single-rating dimension. Still PATCH-able so older callers
  // keep working until they migrate to inherent/residual.
  likelihood: string | undefined;
  impact: string | undefined;
  risk_rating: string | undefined;
  // Inherent (pre-controls) — optional at update.
  inherent_likelihood: string | undefined;
  inherent_impact: string | undefined;
  inherent_rating: string | undefined;
  // Residual (post-controls) — optional at update.
  residual_likelihood: string | undefined;
  residual_impact: string | undefined;
  residual_rating: string | undefined;
  status: string | undefined;
  treatment: string | null | undefined;
  owner: string | null | undefined;
  owner_user_id: string | null | undefined;
  due_date: string | null | undefined;
  source_type: string | null | undefined;
  source_id: string | null | undefined;
  // RR-5: per-risk override of the org cadence policy. NULL clears the
  // override and falls back to the org policy / documented defaults.
  review_cadence_days: number | null | undefined;
};

export type RiskUpdateResult =
  | { input: RiskUpdateInput }
  | { error: string; detail?: string };

export function validateRiskUpdate(body: unknown): RiskUpdateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  const KNOWN_FIELDS = new Set([
    "title", "description", "domain", "likelihood", "impact",
    "risk_rating", "status", "treatment", "owner", "owner_user_id",
    "due_date", "source_type", "source_id",
    "inherent_likelihood", "inherent_impact", "inherent_rating",
    "residual_likelihood", "residual_impact", "residual_rating",
    // RR-5
    "review_cadence_days"
  ]);

  const hasField = [...KNOWN_FIELDS].some(f => f in b);
  if (!hasField) {
    return { error: "no_fields_to_update" };
  }

  let title: string | undefined;
  if ("title" in b) {
    if (!isNonEmptyString(b["title"])) {
      return { error: "title_must_be_non_empty_string" };
    }
    title = sanitizeString((b["title"] as string).trim(), MAX_TITLE);
  }

  let domain: string | undefined;
  if ("domain" in b) {
    if (!isNonEmptyString(b["domain"])) {
      return { error: "domain_must_be_non_empty_string" };
    }
    domain = sanitizeString((b["domain"] as string).trim(), MAX_DOMAIN);
  }

  let likelihood: string | undefined;
  if ("likelihood" in b) {
    if (!isNonEmptyString(b["likelihood"])) {
      return { error: "likelihood_must_be_non_empty_string" };
    }
    if (!VALID_LIKELIHOODS.has(b["likelihood"] as string)) {
      return {
        error: "invalid_likelihood",
        detail: "Must be one of: very_likely, likely, possible, unlikely, rare"
      };
    }
    likelihood = b["likelihood"] as string;
  }

  let impact: string | undefined;
  if ("impact" in b) {
    if (!isNonEmptyString(b["impact"])) {
      return { error: "impact_must_be_non_empty_string" };
    }
    if (!VALID_IMPACTS.has(b["impact"] as string)) {
      return {
        error: "invalid_impact",
        detail: "Must be one of: Critical, High, Moderate, Low"
      };
    }
    impact = b["impact"] as string;
  }

  let risk_rating: string | undefined;
  if ("risk_rating" in b) {
    if (!isNonEmptyString(b["risk_rating"])) {
      return { error: "risk_rating_must_be_non_empty_string" };
    }
    if (!VALID_RISK_RATINGS.has(b["risk_rating"] as string)) {
      return {
        error: "invalid_risk_rating",
        detail: "Must be one of: Critical, High, Moderate, Low"
      };
    }
    risk_rating = b["risk_rating"] as string;
  }

  // ─── Inherent (pre-controls) — optional trio at update
  let inherent_likelihood: string | undefined;
  if ("inherent_likelihood" in b) {
    if (!isNonEmptyString(b["inherent_likelihood"])) {
      return { error: "inherent_likelihood_must_be_non_empty_string" };
    }
    if (!VALID_INHERENT_LIKELIHOODS.has(b["inherent_likelihood"] as string)) {
      return {
        error: "invalid_inherent_likelihood",
        detail: "Must be one of: very_likely, likely, possible, unlikely, rare"
      };
    }
    inherent_likelihood = b["inherent_likelihood"] as string;
  }

  let inherent_impact: string | undefined;
  if ("inherent_impact" in b) {
    if (!isNonEmptyString(b["inherent_impact"])) {
      return { error: "inherent_impact_must_be_non_empty_string" };
    }
    if (!VALID_INHERENT_IMPACTS.has(b["inherent_impact"] as string)) {
      return {
        error: "invalid_inherent_impact",
        detail: "Must be one of: Critical, High, Moderate, Low"
      };
    }
    inherent_impact = b["inherent_impact"] as string;
  }

  let inherent_rating: string | undefined;
  if ("inherent_rating" in b) {
    if (!isNonEmptyString(b["inherent_rating"])) {
      return { error: "inherent_rating_must_be_non_empty_string" };
    }
    if (!VALID_INHERENT_RATINGS.has(b["inherent_rating"] as string)) {
      return {
        error: "invalid_inherent_rating",
        detail: "Must be one of: Critical, High, Moderate, Low"
      };
    }
    inherent_rating = b["inherent_rating"] as string;
  }

  // ─── Residual (post-controls) — optional trio at update
  let residual_likelihood: string | undefined;
  if ("residual_likelihood" in b) {
    if (!isNonEmptyString(b["residual_likelihood"])) {
      return { error: "residual_likelihood_must_be_non_empty_string" };
    }
    if (!VALID_RESIDUAL_LIKELIHOODS.has(b["residual_likelihood"] as string)) {
      return {
        error: "invalid_residual_likelihood",
        detail: "Must be one of: very_likely, likely, possible, unlikely, rare"
      };
    }
    residual_likelihood = b["residual_likelihood"] as string;
  }

  let residual_impact: string | undefined;
  if ("residual_impact" in b) {
    if (!isNonEmptyString(b["residual_impact"])) {
      return { error: "residual_impact_must_be_non_empty_string" };
    }
    if (!VALID_RESIDUAL_IMPACTS.has(b["residual_impact"] as string)) {
      return {
        error: "invalid_residual_impact",
        detail: "Must be one of: Critical, High, Moderate, Low"
      };
    }
    residual_impact = b["residual_impact"] as string;
  }

  let residual_rating: string | undefined;
  if ("residual_rating" in b) {
    if (!isNonEmptyString(b["residual_rating"])) {
      return { error: "residual_rating_must_be_non_empty_string" };
    }
    if (!VALID_RESIDUAL_RATINGS.has(b["residual_rating"] as string)) {
      return {
        error: "invalid_residual_rating",
        detail: "Must be one of: Critical, High, Moderate, Low"
      };
    }
    residual_rating = b["residual_rating"] as string;
  }

  let status: string | undefined;
  if ("status" in b) {
    if (!isNonEmptyString(b["status"])) {
      return { error: "status_must_be_non_empty_string" };
    }
    if (!VALID_STATUSES.has(b["status"] as string)) {
      return {
        error: "invalid_status",
        detail: "Must be one of: open, accepted, mitigated, closed, transferred"
      };
    }
    status = b["status"] as string;
  }

  let description: string | null | undefined;
  if ("description" in b) {
    if (b["description"] !== null && typeof b["description"] !== "string") {
      return { error: "description_must_be_string_or_null" };
    }
    description =
      typeof b["description"] === "string" && b["description"].trim().length > 0
        ? sanitizeString(b["description"].trim(), MAX_DESCRIPTION)
        : null;
  }

  let treatment: string | null | undefined;
  if ("treatment" in b) {
    if (b["treatment"] !== null && typeof b["treatment"] !== "string") {
      return { error: "treatment_must_be_string_or_null" };
    }
    treatment =
      typeof b["treatment"] === "string" && b["treatment"].trim().length > 0
        ? sanitizeString(b["treatment"].trim(), MAX_TREATMENT)
        : null;
  }

  let owner: string | null | undefined;
  if ("owner" in b) {
    if (b["owner"] !== null && typeof b["owner"] !== "string") {
      return { error: "owner_must_be_string_or_null" };
    }
    owner =
      typeof b["owner"] === "string" && b["owner"].trim().length > 0
        ? sanitizeString(b["owner"].trim(), MAX_OWNER)
        : null;
  }

  // owner_user_id — optional UUID or null on PATCH. Same-org check
  // happens in the route handler.
  let owner_user_id: string | null | undefined;
  if ("owner_user_id" in b) {
    if (b["owner_user_id"] === null) {
      owner_user_id = null;
    } else if (isUuid(b["owner_user_id"])) {
      owner_user_id = b["owner_user_id"] as string;
    } else {
      return { error: "owner_user_id_must_be_uuid_or_null" };
    }
  }

  let due_date: string | null | undefined;
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
    } else {
      due_date = null;
    }
  }

  // source_type and source_id — must be cleared or set together
  // RR-5: review_cadence_days override. Either a positive integer or null
  // (clears the override). Absent = unchanged.
  let review_cadence_days: number | null | undefined;
  if ("review_cadence_days" in b) {
    const raw = b["review_cadence_days"];
    if (raw === null) {
      review_cadence_days = null;
    } else if (
      typeof raw !== "number" ||
      !Number.isFinite(raw) ||
      !Number.isInteger(raw) ||
      raw <= 0
    ) {
      return {
        error: "review_cadence_days_must_be_positive_integer_or_null",
        detail: "review_cadence_days must be a positive integer or null."
      };
    } else {
      review_cadence_days = raw;
    }
  }

  let source_type: string | null | undefined;
  let source_id: string | null | undefined;

  const sourceTypePresent = "source_type" in b;
  const sourceIdPresent = "source_id" in b;

  if (sourceTypePresent !== sourceIdPresent) {
    return {
      error: "source_type_and_source_id_must_be_updated_together",
      detail: "Both source_type and source_id must be present or absent in update"
    };
  }

  if (sourceTypePresent && sourceIdPresent) {
    const stVal = b["source_type"];
    const siVal = b["source_id"];

    if (stVal === null && siVal === null) {
      source_type = null;
      source_id = null;
    } else {
      if (!isNonEmptyString(stVal)) {
        return { error: "source_type_must_be_non_empty_string" };
      }
      if (!isUuid(siVal)) {
        return { error: "source_id_must_be_uuid" };
      }
      source_type = (stVal as string).trim();
      source_id = siVal as string;
    }
  }

  return {
    input: {
      title,
      description,
      domain,
      likelihood,
      impact,
      risk_rating,
      inherent_likelihood,
      inherent_impact,
      inherent_rating,
      residual_likelihood,
      residual_impact,
      residual_rating,
      status,
      treatment,
      owner,
      owner_user_id,
      due_date,
      source_type,
      source_id,
      review_cadence_days
    }
  };
}

// ---------------------------------------------------------------------------
// validateRiskListQuery — GET /api/risks query params
// ---------------------------------------------------------------------------

export type RiskListQueryInput = {
  status: string | null;
  domain: string | null;
  risk_rating: string | null;
  // RR-5: filter on review-cadence position relative to today.
  review_status: "overdue" | "due_soon" | "up_to_date" | null;
  limit: number;
  before_created_at: string | null;
  before_id: string | null;
};

const VALID_REVIEW_STATUSES = new Set(["overdue", "due_soon", "up_to_date"]);

export type RiskListQueryResult =
  | { input: RiskListQueryInput }
  | { error: string; detail?: string };

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(value: unknown): number {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export function validateRiskListQuery(query: unknown): RiskListQueryResult {
  if (query === null || typeof query !== "object" || Array.isArray(query)) {
    return { error: "query_params_invalid" };
  }

  const q = query as Record<string, unknown>;

  let status: string | null = null;
  if ("status" in q && isNonEmptyString(q["status"])) {
    if (!VALID_STATUSES.has(q["status"] as string)) {
      return {
        error: "invalid_status_filter",
        detail: "Must be one of: open, accepted, mitigated, closed, transferred"
      };
    }
    status = q["status"] as string;
  }

  let domain: string | null = null;
  if ("domain" in q && isNonEmptyString(q["domain"])) {
    domain = (q["domain"] as string).trim();
  }

  let risk_rating: string | null = null;
  if ("risk_rating" in q && isNonEmptyString(q["risk_rating"])) {
    if (!VALID_RISK_RATINGS.has(q["risk_rating"] as string)) {
      return {
        error: "invalid_risk_rating_filter",
        detail: "Must be one of: Critical, High, Moderate, Low"
      };
    }
    risk_rating = q["risk_rating"] as string;
  }

  let review_status: "overdue" | "due_soon" | "up_to_date" | null = null;
  if ("review_status" in q && isNonEmptyString(q["review_status"])) {
    const v = (q["review_status"] as string).trim();
    if (!VALID_REVIEW_STATUSES.has(v)) {
      return {
        error: "invalid_review_status_filter",
        detail: "Must be one of: overdue, due_soon, up_to_date"
      };
    }
    review_status = v as "overdue" | "due_soon" | "up_to_date";
  }

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
    input: { status, domain, risk_rating, review_status, limit, before_created_at, before_id }
  };
}
