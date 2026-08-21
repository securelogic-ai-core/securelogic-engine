import { sanitizeString } from "./sanitize.js";

// ---------------------------------------------------------------------------
// Field length caps
// ---------------------------------------------------------------------------

const MAX_TITLE = 255;
const MAX_DESCRIPTION = 2000;
const MAX_DOMAIN = 100;
const MAX_SCORING_RATIONALE = 2000;

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

/**
 * FINDING_SOURCE_TYPES — the COMPLETE findings.source_type vocabulary, kept in
 * lock-step with the DB CHECK (db/migrations/20260823_findings_intelligence_event.sql;
 * drift is pinned by findingVocabularyContract.test.ts).
 *
 * This is the FILTER vocabulary (list + export query params). It includes the
 * four types only the engine's own writers create — cyber_signal,
 * applicability_assessment, asset_assessment, intelligence_event. D-15: these
 * were missing from every route-local copy, so automated findings could not
 * be filtered by source through the public API.
 */
export const FINDING_SOURCE_TYPES = new Set([
  "assessment",
  "control_test",
  "vendor_review",
  "vendor_cycle_review",
  "ai_review",
  "ai_governance_review",
  "obligation_review",
  "dependency_review",
  "cyber_signal",
  "signal",
  "manual",
  "risk",
  "applicability_assessment",
  "asset_assessment",
  "intelligence_event",
  "vendor_engagement",
  "pen_test"
]);

/**
 * USER_CREATABLE_SOURCE_TYPES — the subset a caller may claim on
 * POST /api/findings. The engine-written types are deliberately EXCLUDED:
 * accepting them here would let a user mint findings that impersonate
 * pipeline provenance (a cyber_signal finding nobody's matcher produced).
 */
export const USER_CREATABLE_SOURCE_TYPES = new Set([
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
  "risk",
  // A penetration test is something a CUSTOMER commissions and reports, not
  // something a pipeline produces — so unlike cyber_signal it is user-creatable
  // by design. source_id points at a pen_test_engagements row the caller's org
  // owns; that ownership is verified in the route, not here.
  "pen_test"
]);

/**
 * FINDING_STATUSES — the legacy governed-status axis in full
 * (finding-lifecycle-spec §1.2). Filter vocabulary for list/export.
 */
export const FINDING_STATUSES = new Set([
  "open",
  "in_progress",
  "closed",
  "accepted"
]);

/**
 * KNOWN_FINDING_DOMAINS — filter vocabulary for the domain query param.
 * Note: domain is free text at create (capped, sanitized) — this set validates
 * FILTERS only and must stay a superset of what the product writes by default.
 */
export const KNOWN_FINDING_DOMAINS = new Set([
  "Cyber", "Compliance", "Vendor", "AI", "Operational", "Strategic",
  "Legal", "Financial", "General",
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
  /**
   * NULL means the finding has NO canonical severity — the source stated none
   * (Informational / CVSS 0.0) or its value could not be mapped. It is not a
   * hidden fifth level and it never acquires an SLA. Only legal alongside
   * source_severity.
   */
  severity: string | null;
  source_type: string;
  description: string;
  source_id: string | null;
  domain: string | null;
  priority: string | null;
  likelihood: string | null;
  confidence: string | null;
  time_sensitivity: string | null;
  scoring_rationale: string | null;
  owner_user_id: string | null;
  due_date: string | null;
  /** What the source called it, verbatim. Never normalised. */
  source_severity: string | null;
  /** The finding's id in the source report, so a customer can match the PDF. */
  source_reference_id: string | null;
  cvss_score: number | null;
  cvss_vector: string | null;
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
  const title = sanitizeString((b["title"] as string).trim(), MAX_TITLE);

  // ── source provenance (SL-PENTEST-IN) ──────────────────────────────────
  // Read before severity, because whether a canonical severity may be omitted
  // depends on whether the source's own value was preserved.
  const source_severity = isNonEmptyString(b["source_severity"])
    ? sanitizeString((b["source_severity"] as string).trim(), 120)
    : null;

  // severity — enum, and OPTIONAL only when the source's value is preserved.
  //
  // NULL means "this finding has no canonical severity". That is a legitimate,
  // faithful outcome for an Informational finding or an unreadable value, and
  // it carries no SLA because slaDaysFor() recognises no such severity.
  //
  // The pairing is the invariant: omitting severity WITHOUT source_severity is
  // not an honest "no severity", it is missing data, and it would produce a
  // finding nobody can triage or explain. So it is refused.
  const severityProvided = isNonEmptyString(b["severity"]);
  if (!severityProvided) {
    if (source_severity === null) {
      return {
        error: "severity_required",
        detail:
          "Provide a canonical severity, or supply source_severity to record " +
          "that the source stated none (e.g. Informational)."
      };
    }
  } else if (!VALID_SEVERITIES.has(b["severity"] as string)) {
    return {
      error: "invalid_severity",
      detail: "Must be one of: Critical, High, Moderate, Low"
    };
  }
  const severity = severityProvided ? (b["severity"] as string) : null;

  // source_type — required enum
  if (!isNonEmptyString(b["source_type"])) {
    return { error: "source_type_required" };
  }
  if (!USER_CREATABLE_SOURCE_TYPES.has(b["source_type"] as string)) {
    return {
      error: "invalid_source_type",
      detail: `Must be one of: ${[...USER_CREATABLE_SOURCE_TYPES].join(", ")}`
    };
  }
  const source_type = b["source_type"] as string;

  // description — required non-empty string
  if (!isNonEmptyString(b["description"])) {
    return { error: "description_required" };
  }
  const description = sanitizeString((b["description"] as string).trim(), MAX_DESCRIPTION);

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
        ? sanitizeString(b["domain"].trim(), MAX_DOMAIN)
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
        ? sanitizeString(b["scoring_rationale"].trim(), MAX_SCORING_RATIONALE)
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

  // ── remaining source provenance ────────────────────────────────────────
  const source_reference_id = isNonEmptyString(b["source_reference_id"])
    ? sanitizeString((b["source_reference_id"] as string).trim(), 120)
    : null;

  const cvss_vector = isNonEmptyString(b["cvss_vector"])
    ? sanitizeString((b["cvss_vector"] as string).trim(), 200)
    : null;

  // Range-checked here as well as by the column CHECK, so a bad score is a 400
  // the importer can explain rather than a 500 from the driver.
  let cvss_score: number | null = null;
  if (b["cvss_score"] !== undefined && b["cvss_score"] !== null && b["cvss_score"] !== "") {
    const n = typeof b["cvss_score"] === "number" ? b["cvss_score"] : Number(b["cvss_score"]);
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      return {
        error: "invalid_cvss_score",
        detail: "cvss_score must be a number between 0.0 and 10.0."
      };
    }
    cvss_score = Math.round(n * 10) / 10;
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
      due_date,
      source_severity,
      source_reference_id,
      cvss_score,
      cvss_vector
    }
  };
}
