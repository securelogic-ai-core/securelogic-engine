/**
 * vendorAssuranceValidation.ts — Pure validators for vendor-assurance routes.
 *
 * No DB I/O. organization_id is NEVER read from the body.
 *
 * Three validators:
 *   - validateUploadMetadata    — POST /api/vendor-assurance/documents body
 *                                 (parsed multipart form fields, not the file)
 *   - validateReviewDecisions   — POST /api/vendor-assurance/extractions/:id/
 *                                 review-decisions body (one or more decisions)
 *   - computeFinalizePrecondition — given a current-decision-per-field map,
 *                                   returns the names of material fields that
 *                                   are still missing a current decision
 */

import { sanitizeString } from "./sanitize.js";
import { MATERIAL_FIELD_NAMES, isMaterialFieldName } from "./socExtractionPrompt.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_DOCUMENT_TYPE_HINTS = ["soc1", "soc2_type1", "soc2_type2"] as const;
const VALID_DECISIONS = ["accept", "edit", "reject"] as const;

export const MAX_BYTE_SIZE = 25 * 1024 * 1024; // 25 MB
export const MAX_FILENAME = 255;
export const MAX_REVIEWER_NOTE = 2000;
export const MAX_OVERRIDE_REASON = 1000;
export const MAX_MANUAL_REVIEW_COMMENT = 1000;

export type UploadMetadata = {
  vendor_id: string;
  document_type_hint: "soc1" | "soc2_type1" | "soc2_type2" | null;
  original_filename: string;
};

export type ReviewDecisionInput = {
  field_name: string;
  decision: "accept" | "edit" | "reject";
  /** Required iff decision === 'edit'. */
  reviewed_value: unknown;
  reviewer_note: string | null;
};

export type ReviewDecisionsInput = {
  decisions: ReviewDecisionInput[];
};

export type FieldOverrideInput = {
  field_name: string;
  /** Any JSON value the reviewer wants to substitute for the extracted value. */
  override_value: unknown;
  reason: string;
};

export type RejectInput = {
  reason: string;
};

export type ManualReviewInput = {
  comment: string | null;
};

export type ValidationOk<T> = { input: T };
export type ValidationErr = { error: string; detail?: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

/**
 * Validate the parsed multipart body fields. The file itself (size, mime)
 * is checked at the multer layer + the route. This validator handles the
 * accompanying form-fields only.
 *
 * `original_filename` comes from req.file.originalname at the route layer
 * and is sanitized here.
 */
export function validateUploadMetadata(
  body: unknown,
  originalFilename: string
): ValidationOk<UploadMetadata> | ValidationErr {
  if (!isPlainObject(body)) {
    return { error: "request_body_must_be_object" };
  }

  const vendorId = body["vendor_id"];
  if (typeof vendorId !== "string" || !UUID_RE.test(vendorId.trim())) {
    return { error: "vendor_id_must_be_uuid" };
  }

  let documentTypeHint: UploadMetadata["document_type_hint"] = null;
  if (body["document_type_hint"] !== undefined && body["document_type_hint"] !== null && body["document_type_hint"] !== "") {
    const hint = body["document_type_hint"];
    if (typeof hint !== "string" || !(VALID_DOCUMENT_TYPE_HINTS as readonly string[]).includes(hint)) {
      return {
        error: "invalid_document_type_hint",
        detail: `must be one of: ${VALID_DOCUMENT_TYPE_HINTS.join(", ")}`
      };
    }
    documentTypeHint = hint as UploadMetadata["document_type_hint"];
  }

  if (typeof originalFilename !== "string" || originalFilename.trim().length === 0) {
    return { error: "original_filename_required" };
  }
  const cleanedFilename = sanitizeString(originalFilename, MAX_FILENAME);

  return {
    input: {
      vendor_id: vendorId.trim(),
      document_type_hint: documentTypeHint,
      original_filename: cleanedFilename
    }
  };
}

/**
 * Validate the body of POST .../review-decisions. The body must contain a
 * non-empty `decisions` array. Each decision must name a material field, a
 * decision enum, and (iff decision='edit') a non-null reviewed_value.
 */
export function validateReviewDecisions(
  body: unknown
): ValidationOk<ReviewDecisionsInput> | ValidationErr {
  if (!isPlainObject(body)) {
    return { error: "request_body_must_be_object" };
  }
  const arr = body["decisions"];
  if (!Array.isArray(arr) || arr.length === 0) {
    return { error: "decisions_must_be_non_empty_array" };
  }

  const out: ReviewDecisionInput[] = [];
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i];
    if (!isPlainObject(d)) {
      return { error: "decision_must_be_object", detail: `decisions[${i}]` };
    }
    const fieldName = d["field_name"];
    if (typeof fieldName !== "string" || !isMaterialFieldName(fieldName)) {
      return {
        error: "unknown_field_name",
        detail: `decisions[${i}].field_name must be one of: ${MATERIAL_FIELD_NAMES.join(", ")}`
      };
    }
    const decision = d["decision"];
    if (typeof decision !== "string" || !(VALID_DECISIONS as readonly string[]).includes(decision)) {
      return {
        error: "invalid_decision",
        detail: `decisions[${i}].decision must be one of: ${VALID_DECISIONS.join(", ")}`
      };
    }

    let reviewedValue: unknown = null;
    if (decision === "edit") {
      if (!("reviewed_value" in d) || d["reviewed_value"] === undefined || d["reviewed_value"] === null) {
        return {
          error: "reviewed_value_required_for_edit",
          detail: `decisions[${i}]`
        };
      }
      reviewedValue = d["reviewed_value"];
    } else {
      // accept / reject: ignore any reviewed_value supplied — store null.
      reviewedValue = null;
    }

    let reviewerNote: string | null = null;
    if (d["reviewer_note"] !== undefined && d["reviewer_note"] !== null) {
      if (typeof d["reviewer_note"] !== "string") {
        return { error: "reviewer_note_must_be_string", detail: `decisions[${i}]` };
      }
      const cleaned = sanitizeString(d["reviewer_note"].trim(), MAX_REVIEWER_NOTE);
      reviewerNote = cleaned.length === 0 ? null : cleaned;
    }

    out.push({
      field_name: fieldName,
      decision: decision as ReviewDecisionInput["decision"],
      reviewed_value: reviewedValue,
      reviewer_note: reviewerNote
    });
  }

  return { input: { decisions: out } };
}

/**
 * Given a current-decision-per-field map (latest-by-decided_at projection
 * already computed in SQL), return the names of material fields that lack
 * a current decision. An empty array means finalize is permitted.
 */
export function computeFinalizePrecondition(
  currentDecisionsByField: Record<string, { decision: "accept" | "edit" | "reject" } | null | undefined>
): { ok: true } | { ok: false; missing_field_names: string[] } {
  const missing: string[] = [];
  for (const name of MATERIAL_FIELD_NAMES) {
    const d = currentDecisionsByField[name];
    if (!d || (d.decision !== "accept" && d.decision !== "edit" && d.decision !== "reject")) {
      missing.push(name);
    }
  }
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing_field_names: missing };
}

// ---------------------------------------------------------------------------
// Document-presentation package: field-override + reject + manual-review bodies
// ---------------------------------------------------------------------------

/**
 * Validate the body of POST .../field-overrides:
 *   { field_name: <material field>, override_value: <any JSON value>, reason: <non-empty string> }
 *
 * `override_value` may be any JSON value INCLUDING null (a reviewer may
 * legitimately override an extracted value to "none"); it must, however, be
 * present as a key — `undefined` is rejected. `reason` is required and must be
 * a non-empty string after trimming; it is sanitized + clamped to
 * MAX_OVERRIDE_REASON.
 */
export function validateFieldOverrideBody(
  body: unknown
): ValidationOk<FieldOverrideInput> | ValidationErr {
  if (!isPlainObject(body)) {
    return { error: "request_body_must_be_object" };
  }

  const fieldName = body["field_name"];
  if (typeof fieldName !== "string" || !isMaterialFieldName(fieldName)) {
    return {
      error: "unknown_field_name",
      detail: `field_name must be one of: ${MATERIAL_FIELD_NAMES.join(", ")}`
    };
  }

  if (!("override_value" in body) || body["override_value"] === undefined) {
    return { error: "override_value_required" };
  }
  const overrideValue = body["override_value"];

  const reasonRaw = body["reason"];
  if (typeof reasonRaw !== "string" || reasonRaw.trim().length === 0) {
    return { error: "reason_required" };
  }
  const reason = sanitizeString(reasonRaw.trim(), MAX_OVERRIDE_REASON);
  if (reason.length === 0) {
    return { error: "reason_required" };
  }

  return { input: { field_name: fieldName, override_value: overrideValue, reason } };
}

/**
 * Validate the body of POST .../reject:  { reason: <non-empty string> }.
 */
export function validateRejectBody(
  body: unknown
): ValidationOk<RejectInput> | ValidationErr {
  if (!isPlainObject(body)) {
    return { error: "request_body_must_be_object" };
  }
  const reasonRaw = body["reason"];
  if (typeof reasonRaw !== "string" || reasonRaw.trim().length === 0) {
    return { error: "reason_required" };
  }
  const reason = sanitizeString(reasonRaw.trim(), MAX_OVERRIDE_REASON);
  if (reason.length === 0) {
    return { error: "reason_required" };
  }
  return { input: { reason } };
}

/**
 * Validate the body of POST .../request-manual-review:
 *   { comment?: <string> }   — optional; sanitized + clamped; absent/blank → null.
 */
export function validateManualReviewBody(
  body: unknown
): ValidationOk<ManualReviewInput> | ValidationErr {
  if (body === undefined || body === null) {
    return { input: { comment: null } };
  }
  if (!isPlainObject(body)) {
    return { error: "request_body_must_be_object" };
  }
  const commentRaw = body["comment"];
  if (commentRaw === undefined || commentRaw === null) {
    return { input: { comment: null } };
  }
  if (typeof commentRaw !== "string") {
    return { error: "comment_must_be_string" };
  }
  const cleaned = sanitizeString(commentRaw.trim(), MAX_MANUAL_REVIEW_COMMENT);
  return { input: { comment: cleaned.length === 0 ? null : cleaned } };
}

// ---------------------------------------------------------------------------
// CUEC-matcher package: mapping create/update + cuec review-status bodies
// ---------------------------------------------------------------------------

const CUEC_MAPPING_TARGET_STATUSES = ["accepted", "dismissed"] as const;
const CUEC_REVIEW_STATUSES = ["pending", "reviewed_no_match"] as const;

export type CreateCuecMappingInput = { control_id: string; reason: string | null };
export type UpdateCuecMappingInput = { mapping_status: "accepted" | "dismissed"; reason: string | null };
export type UpdateCuecReviewStatusInput = { review_status: "pending" | "reviewed_no_match"; reason: string | null };

function optionalReason(body: Record<string, unknown>): string | null | ValidationErr {
  const raw = body["reason"];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return { error: "reason_must_be_string" };
  const cleaned = sanitizeString(raw.trim(), MAX_OVERRIDE_REASON);
  return cleaned.length === 0 ? null : cleaned;
}

/** POST /api/vendor-assurance/cuecs/:id/mappings — user creates a manual mapping. */
export function validateCreateCuecMappingBody(
  body: unknown
): ValidationOk<CreateCuecMappingInput> | ValidationErr {
  if (!isPlainObject(body)) return { error: "request_body_must_be_object" };
  const controlId = body["control_id"];
  if (typeof controlId !== "string" || !UUID_RE.test(controlId.trim())) {
    return { error: "control_id_must_be_uuid" };
  }
  const reason = optionalReason(body);
  if (reason !== null && typeof reason === "object") return reason;
  return { input: { control_id: controlId.trim(), reason } };
}

/** PATCH /api/vendor-assurance/cuec-mappings/:id — accept a suggestion or dismiss a mapping. */
export function validateUpdateCuecMappingBody(
  body: unknown
): ValidationOk<UpdateCuecMappingInput> | ValidationErr {
  if (!isPlainObject(body)) return { error: "request_body_must_be_object" };
  const ms = body["mapping_status"];
  if (typeof ms !== "string" || !(CUEC_MAPPING_TARGET_STATUSES as readonly string[]).includes(ms)) {
    return { error: "invalid_mapping_status", detail: `must be one of: ${CUEC_MAPPING_TARGET_STATUSES.join(", ")}` };
  }
  const reason = optionalReason(body);
  if (reason !== null && typeof reason === "object") return reason;
  if (ms === "dismissed" && (reason === null || reason.length === 0)) {
    return { error: "reason_required_for_dismissed" };
  }
  return { input: { mapping_status: ms as "accepted" | "dismissed", reason } };
}

/** POST /api/vendor-assurance/cuecs/:id/review-status — set/clear the "no applicable control" marker. */
export function validateUpdateCuecReviewStatusBody(
  body: unknown
): ValidationOk<UpdateCuecReviewStatusInput> | ValidationErr {
  if (!isPlainObject(body)) return { error: "request_body_must_be_object" };
  const rs = body["review_status"];
  if (typeof rs !== "string" || !(CUEC_REVIEW_STATUSES as readonly string[]).includes(rs)) {
    return { error: "invalid_review_status", detail: `must be one of: ${CUEC_REVIEW_STATUSES.join(", ")}` };
  }
  let reason = optionalReason(body);
  if (reason !== null && typeof reason === "object") return reason;
  // reason is only meaningful for 'reviewed_no_match'; clearing back to 'pending' drops it.
  if (rs === "pending") reason = null;
  return { input: { review_status: rs as "pending" | "reviewed_no_match", reason } };
}
