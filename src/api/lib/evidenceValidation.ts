/**
 * evidenceValidation.ts — Pure validation for evidence routes.
 *
 * No I/O. Returns a discriminated union: { input } | { error, detail? }.
 *
 * Source types and evidence types are the canonical enums defined in
 * CANONICAL_RISK_MODEL.md.
 */

// ---------------------------------------------------------------------------
// Canonical enums
// ---------------------------------------------------------------------------

export const VALID_SOURCE_TYPES = new Set([
  "control_test",
  "vendor_review",
  "ai_review",
  "ai_governance_review",
  "obligation_review",
  "dependency_review",
  "risk_treatment",
  "finding",
  "policy_review"
]);

export const VALID_EVIDENCE_TYPES = new Set([
  "document",
  "screenshot",
  "log",
  "test_result",
  "interview",
  "observation",
  "policy",
  "other"
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
// validateEvidenceCreate — POST /api/evidence body
// ---------------------------------------------------------------------------

export type EvidenceCreateInput = {
  source_type: string;
  source_id: string;
  title: string;
  description: string | null;
  evidence_type: string;
  collected_at: string | null;
  collected_by: string | null;
  external_ref: string | null;
};

export type EvidenceCreateResult =
  | { input: EvidenceCreateInput }
  | { error: string; detail?: string };

export function validateEvidenceCreate(body: unknown): EvidenceCreateResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }

  const b = body as Record<string, unknown>;

  // source_type — required enum
  if (!isNonEmptyString(b["source_type"])) {
    return { error: "source_type_required" };
  }
  if (!VALID_SOURCE_TYPES.has(b["source_type"] as string)) {
    return {
      error: "invalid_source_type",
      detail:
        "Must be one of: control_test, vendor_review, ai_review, obligation_review, " +
        "ai_governance_review, dependency_review, risk_treatment, finding, policy_review"
    };
  }
  const source_type = b["source_type"] as string;

  // source_id — required UUID
  if (!isNonEmptyString(b["source_id"])) {
    return { error: "source_id_required" };
  }
  if (!isUuid(b["source_id"])) {
    return { error: "source_id_must_be_uuid" };
  }
  const source_id = b["source_id"] as string;

  // title + evidence_type + optional metadata — shared with the risk-scoped
  // evidence route (Epic R4), which supplies source_type/source_id from the URL.
  const meta = validateEvidenceMetadata(b);
  if ("error" in meta) return meta;

  return { input: { source_type, source_id, ...meta.metadata } };
}

// ---------------------------------------------------------------------------
// validateEvidenceMetadata — the source-agnostic fields of an evidence record.
// Reused by validateEvidenceCreate (generic POST /api/evidence) and by the
// risk-scoped POST /api/risks/:id/evidence route, which derives source_type='risk'
// and source_id from the URL rather than the body. Keeping this in one place
// means both paths validate title/evidence_type/dates identically.
// ---------------------------------------------------------------------------

export type EvidenceMetadata = {
  title: string;
  description: string | null;
  evidence_type: string;
  collected_at: string | null;
  collected_by: string | null;
  external_ref: string | null;
};

export type EvidenceMetadataResult =
  | { metadata: EvidenceMetadata }
  | { error: string; detail?: string };

export function validateEvidenceMetadata(body: unknown): EvidenceMetadataResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "request_body_required" };
  }
  const b = body as Record<string, unknown>;

  // title — required non-empty string
  if (!isNonEmptyString(b["title"])) {
    return { error: "title_required" };
  }
  const title = (b["title"] as string).trim();

  // evidence_type — required enum
  if (!isNonEmptyString(b["evidence_type"])) {
    return { error: "evidence_type_required" };
  }
  if (!VALID_EVIDENCE_TYPES.has(b["evidence_type"] as string)) {
    return {
      error: "invalid_evidence_type",
      detail:
        "Must be one of: document, screenshot, log, test_result, interview, observation, policy, other"
    };
  }
  const evidence_type = b["evidence_type"] as string;

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

  // collected_at — optional ISO date string (YYYY-MM-DD) or null
  let collected_at: string | null = null;
  if ("collected_at" in b) {
    if (b["collected_at"] !== null) {
      if (typeof b["collected_at"] !== "string") {
        return { error: "collected_at_must_be_date_string_or_null" };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b["collected_at"])) {
        return {
          error: "collected_at_invalid_format",
          detail: "Must be ISO date string: YYYY-MM-DD"
        };
      }
      collected_at = b["collected_at"];
    }
  }

  // collected_by — optional string or null
  let collected_by: string | null = null;
  if ("collected_by" in b) {
    if (b["collected_by"] !== null && typeof b["collected_by"] !== "string") {
      return { error: "collected_by_must_be_string_or_null" };
    }
    collected_by =
      typeof b["collected_by"] === "string" && b["collected_by"].trim().length > 0
        ? b["collected_by"].trim()
        : null;
  }

  // external_ref — optional string or null
  let external_ref: string | null = null;
  if ("external_ref" in b) {
    if (b["external_ref"] !== null && typeof b["external_ref"] !== "string") {
      return { error: "external_ref_must_be_string_or_null" };
    }
    external_ref =
      typeof b["external_ref"] === "string" && b["external_ref"].trim().length > 0
        ? b["external_ref"].trim()
        : null;
  }

  return {
    metadata: { title, description, evidence_type, collected_at, collected_by, external_ref }
  };
}

// ---------------------------------------------------------------------------
// validateEvidenceListQuery — GET /api/evidence query params
// ---------------------------------------------------------------------------

export type EvidenceListQueryInput = {
  source_type: string;
  source_id: string;
};

export type EvidenceListQueryResult =
  | { input: EvidenceListQueryInput }
  | { error: string; detail?: string };

export function validateEvidenceListQuery(
  query: unknown
): EvidenceListQueryResult {
  if (query === null || typeof query !== "object" || Array.isArray(query)) {
    return { error: "query_params_required" };
  }

  const q = query as Record<string, unknown>;

  // source_type — required enum
  if (!isNonEmptyString(q["source_type"])) {
    return { error: "source_type_required" };
  }
  if (!VALID_SOURCE_TYPES.has(q["source_type"] as string)) {
    return {
      error: "invalid_source_type",
      detail: "Must be one of: control_test, vendor_review, ai_review, obligation_review"
    };
  }
  const source_type = q["source_type"] as string;

  // source_id — required UUID
  if (!isNonEmptyString(q["source_id"])) {
    return { error: "source_id_required" };
  }
  if (!isUuid(q["source_id"])) {
    return { error: "source_id_must_be_uuid" };
  }
  const source_id = q["source_id"] as string;

  return { input: { source_type, source_id } };
}
