/**
 * assetAssessmentValidation.ts — Pure validation for the generic
 * asset-assessment routes (EAR P10).
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 * Vocabulary source of truth: ASSESSMENT_TYPE_SPECS.asset (assessmentSpec.ts).
 * Body shape mirrors the obligation-assessment validators (the template stack
 * per the P10 memo) with the subject generalized to an AssetRef (EAR-AD-3):
 * (asset_type, asset_id) instead of a single FK column.
 */

import { isAssetType, ASSET_TYPES } from "./assetRegistry.js";
import { ASSESSMENT_TYPE_SPECS, specTransitionAllowed } from "./assessmentSpec.js";

const SPEC = ASSESSMENT_TYPE_SPECS.asset;

const VALID_STATUSES = SPEC.statuses;

// Terminal statuses — assessment cannot be modified once it reaches these states.
export const TERMINAL_STATUSES = SPEC.terminalStatuses!;

// Statuses that trigger finding creation on first transition.
export const FINDING_STATUSES = SPEC.findingStatuses;

export function isValidTransition(from: string, to: string): boolean {
  return specTransitionAllowed(SPEC, from, to);
}

const STATUS_LIST = [...VALID_STATUSES].join(", ");

const VALID_SEVERITIES = new Set(["Critical", "High", "Moderate", "Low"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// validateAssetAssessmentCreate — POST body
// ---------------------------------------------------------------------------

export type AssetAssessmentCreateInput = {
  asset_type: string;
  asset_id: string;
  status: string;
  overall_severity: string | null;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
};

export type AssetAssessmentCreateResult =
  | { input: AssetAssessmentCreateInput }
  | { error: string; detail?: string };

export function validateAssetAssessmentCreate(
  body: unknown
): AssetAssessmentCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // asset_type — required, registry vocabulary
  if (!isNonEmptyString(b["asset_type"])) {
    return { error: "asset_type_required" };
  }
  if (!isAssetType(b["asset_type"])) {
    return {
      error: "invalid_asset_type",
      detail: `Must be one of: ${ASSET_TYPES.join(", ")}`
    };
  }
  const asset_type = b["asset_type"];

  // asset_id — required UUID
  if (!isNonEmptyString(b["asset_id"])) {
    return { error: "asset_id_required" };
  }
  if (!isUuid(b["asset_id"])) {
    return { error: "asset_id_must_be_uuid" };
  }
  const asset_id = b["asset_id"];

  // status — optional, defaults to 'not_started'
  let status = "not_started";
  if ("status" in b) {
    if (!isNonEmptyString(b["status"])) {
      return { error: "status_must_be_non_empty_string" };
    }
    if (!VALID_STATUSES.has(b["status"] as string)) {
      return { error: "invalid_status", detail: `Must be one of: ${STATUS_LIST}` };
    }
    status = b["status"] as string;
  }

  // overall_severity — optional, nullable
  let overall_severity: string | null = null;
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

  const strings = validateOptionalStrings(b);
  if ("error" in strings) return strings;

  return {
    input: {
      asset_type,
      asset_id,
      status,
      overall_severity,
      ...strings.fields
    }
  };
}

// ---------------------------------------------------------------------------
// validateAssetAssessmentStatusTransition — PATCH body
// ---------------------------------------------------------------------------

export type AssetAssessmentStatusTransitionInput = {
  status: string;
  overall_severity: string | null;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
};

export type AssetAssessmentStatusTransitionResult =
  | { input: AssetAssessmentStatusTransitionInput }
  | { error: string; detail?: string };

export function validateAssetAssessmentStatusTransition(
  body: unknown
): AssetAssessmentStatusTransitionResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // status — required
  if (!isNonEmptyString(b["status"])) {
    return { error: "status_required" };
  }
  if (!VALID_STATUSES.has(b["status"] as string)) {
    return { error: "invalid_status", detail: `Must be one of: ${STATUS_LIST}` };
  }
  const status = b["status"] as string;

  // overall_severity — required when transitioning into a finding status
  let overall_severity: string | null = null;
  if (FINDING_STATUSES.has(status)) {
    if (!isNonEmptyString(b["overall_severity"])) {
      return {
        error: "overall_severity_required",
        detail:
          "overall_severity is required when status is 'deficient' or 'remediation_required'"
      };
    }
    if (!VALID_SEVERITIES.has(b["overall_severity"] as string)) {
      return {
        error: "invalid_overall_severity",
        detail: "Must be one of: Critical, High, Moderate, Low"
      };
    }
    overall_severity = b["overall_severity"] as string;
  } else if ("overall_severity" in b && b["overall_severity"] !== null) {
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

  const strings = validateOptionalStrings(b);
  if ("error" in strings) return strings;

  return { input: { status, overall_severity, ...strings.fields } };
}

// ---------------------------------------------------------------------------
// Shared optional-field validation (summary/notes/performed_at/reviewer_id)
// ---------------------------------------------------------------------------

type OptionalFields = {
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
};

function validateOptionalStrings(
  b: Record<string, unknown>
): { fields: OptionalFields } | { error: string; detail?: string } {
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

  let performed_at: string | null = null;
  if ("performed_at" in b && b["performed_at"] !== null) {
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

  let reviewer_id: string | null = null;
  if ("reviewer_id" in b && b["reviewer_id"] !== null) {
    if (!isUuid(b["reviewer_id"])) {
      return { error: "reviewer_id_must_be_uuid_or_null" };
    }
    reviewer_id = b["reviewer_id"] as string;
  }

  return { fields: { summary, notes, performed_at, reviewer_id } };
}
