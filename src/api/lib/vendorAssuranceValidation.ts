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

// A05-G2: per-org cumulative R2 storage quota. Bounds total uploaded-PDF
// bytes per organization (the per-file MAX_BYTE_SIZE alone leaves cumulative
// storage unbounded). Flat across tiers for v1 — every org reaching the
// upload route is already on a paid entitlement (requireEntitlement
// "standard"). 2 GiB ≈ 80 worst-case 25 MiB files, or hundreds of typical
// SOC PDFs; not reachable by legitimate use.
export const MAX_ORG_STORAGE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

export const MAX_FILENAME = 255;
export const MAX_REVIEWER_NOTE = 2000;
export const MAX_OVERRIDE_REASON = 1000;
export const MAX_MANUAL_REVIEW_COMMENT = 1000;
/** A TSC criterion identifier such as `CC6.1`; generous, not a grammar. */
export const MAX_ELEMENT_KEY = 128;

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
  /**
   * S4-4C-0. NULL for a whole-field decision — today's behaviour, unchanged.
   * For `controls`, the EXTRACTED control identifier this decision is about,
   * so five tested controls are five governance decisions rather than one
   * indivisible acceptance of the array.
   */
  element_key: string | null;
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

    // S4-4C-0: an OPTIONAL element key. Absent means a whole-field decision,
    // which is what every non-`controls` field uses and what this route did
    // before. Present, it scopes the decision to ONE tested control — and it is
    // refused on any other field, because `controls` is the only structure
    // whose elements become individually authoritative.
    let elementKey: string | null = null;
    const rawElementKey = d["element_key"];
    if (rawElementKey !== undefined && rawElementKey !== null) {
      if (typeof rawElementKey !== "string") {
        return { error: "element_key_must_be_string", detail: `decisions[${i}]` };
      }
      const cleaned = sanitizeString(rawElementKey.trim(), MAX_ELEMENT_KEY);
      if (cleaned.length === 0) {
        return { error: "element_key_must_not_be_blank", detail: `decisions[${i}]` };
      }
      if (fieldName !== "controls") {
        return {
          error: "element_key_not_supported_for_field",
          detail:
            `decisions[${i}]: element-level review is scoped to 'controls', the only ` +
            `extracted structure whose individual elements carry assurance authority.`
        };
      }
      elementKey = cleaned;
    }

    out.push({
      field_name: fieldName,
      decision: decision as ReviewDecisionInput["decision"],
      reviewed_value: reviewedValue,
      reviewer_note: reviewerNote,
      element_key: elementKey
    });
  }

  return { input: { decisions: out } };
}

/**
 * Given a current-decision-per-field map (latest-by-decided_at projection
 * already computed in SQL), return the names of material fields that lack
 * a current decision. An empty array means finalize is permitted.
 */
/**
 * S4-4C-0: the fields whose review state an ASSURANCE-ELIGIBLE approval
 * depends on.
 *
 * Deliberately NARROWER than MATERIAL_FIELD_NAMES. The legacy `finalize` gate
 * demanded a decision on all fourteen material fields; restoring that verbatim
 * would block approval on fields the coverage chain never reads, which is a
 * different (and unargued) product decision. These are the ones an assurance
 * determination actually consumes:
 *
 *   report_type              Type I vs Type II — different claims entirely
 *   report_period_start/end  currency of the assurance
 *   trust_services_criteria  the report's scope
 *   auditor_opinion          the report-level opinion the governed acceptance
 *                            (20261066/20261070) is proposed from
 *   controls                 the tested controls — the coverage route itself
 *   exceptions               the exception veto; control-attributed
 *   subservice_method        carve-out materiality. Measured: 100% of the
 *   subservice_organizations corpus is `Carve-out`, so this is not hypothetical
 *
 * Deliberately OUT: vendor_name, report_issued_date, auditor_name (identifying,
 * not assurance-bearing), cuecs (the CUEC spine is outside the coverage route
 * by owner ruling), management_responses (the vendor's reply to an exception,
 * not the exception).
 */
export const ASSURANCE_BEARING_FIELD_NAMES: readonly string[] = [
  "report_type",
  "report_period_start",
  "report_period_end",
  "trust_services_criteria",
  "auditor_opinion",
  "controls",
  "exceptions",
  "subservice_method",
  "subservice_organizations",
] as const;

export type ApprovalReviewState = {
  /** Current decision per field, from the DISTINCT ON (field_name) projection. */
  fieldDecisions: Record<string, { decision: "accept" | "edit" | "reject" } | null | undefined>;
  /** Every tested-control identifier present in the extraction. */
  testedControlKeys: readonly string[];
  /** Tested-control identifiers carrying a current element-grain decision. */
  reviewedTestedControlKeys: readonly string[];
};

/**
 * S4-4C-0. May this document enter the assurance-eligible `approved` state?
 *
 * The invariant: an assurance document cannot enter an assurance-eligible
 * approved state without the required governed review state. Two conditions,
 * and the second is the one the old gate could not express at all:
 *
 *   1. every assurance-bearing FIELD carries a current review decision;
 *   2. every tested CONTROL carries its own current element-grain decision.
 *
 * A document with no tested controls satisfies (2) vacuously — that is a report
 * with nothing to reason about, not a bypass, and it still fails (1) unless the
 * `controls` field itself was reviewed.
 */
export function computeApprovalReviewPrecondition(
  state: ApprovalReviewState
): { ok: true } | { ok: false; missing_field_names: string[]; unreviewed_control_keys: string[] } {
  const missing: string[] = [];
  for (const name of ASSURANCE_BEARING_FIELD_NAMES) {
    const d = state.fieldDecisions[name];
    if (!d || (d.decision !== "accept" && d.decision !== "edit" && d.decision !== "reject")) {
      missing.push(name);
    }
  }
  const reviewed = new Set(state.reviewedTestedControlKeys);
  const unreviewed = state.testedControlKeys.filter((k) => !reviewed.has(k));

  if (missing.length === 0 && unreviewed.length === 0) return { ok: true };
  return { ok: false, missing_field_names: missing, unreviewed_control_keys: unreviewed };
}

/**
 * The tested-control identifiers in an extraction's `controls` value, in order,
 * de-duplicated. An entry with no usable identifier is reported as such by the
 * caller rather than silently skipped — an unidentifiable tested control cannot
 * be reviewed, so it must not be approvable either.
 */
export function testedControlKeysOf(controlsValue: unknown): { keys: string[]; unidentified: number } {
  if (!Array.isArray(controlsValue)) return { keys: [], unidentified: 0 };
  const keys: string[] = [];
  let unidentified = 0;
  for (const entry of controlsValue) {
    const id = isPlainObject(entry) ? entry["control_id"] : null;
    if (typeof id === "string" && id.trim().length > 0) {
      const k = id.trim();
      if (!keys.includes(k)) keys.push(k);
    } else {
      unidentified += 1;
    }
  }
  return { keys, unidentified };
}

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
/**
 * CUEC review outcomes (VA-1).
 *
 * The old vocabulary was ["pending", "reviewed_no_match"], and `reviewed_no_match`
 * CONFLATED TWO OPPOSITE CONCLUSIONS: "this does not apply to us" and "this
 * applies and we do not do it". Recording both identically is why 54 ingested
 * documents produced zero findings — nothing in the data model could justify
 * promoting one.
 *
 * `reviewed_no_match` is retained as SETTABLE-BUT-DEPRECATED so environments
 * holding legacy rows keep working; new reviews should choose one of the three
 * explicit outcomes. It is never auto-migrated, because reinterpreting it would
 * invent a determination nobody made.
 */
const CUEC_REVIEW_STATUSES = [
  "pending",
  "not_applicable",
  "satisfied",
  "gap",
  "reviewed_no_match",
] as const;

/** The outcomes that assert something consequential about the organisation. */
export const CUEC_DETERMINED_STATUSES = ["not_applicable", "satisfied", "gap"] as const;

/** The single outcome that justifies remediation work. */
export const CUEC_GAP_STATUS = "gap" as const;

export type CreateCuecMappingInput = { control_id: string; reason: string | null };
export type UpdateCuecMappingInput = { mapping_status: "accepted" | "dismissed"; reason: string | null };
export type CuecReviewStatus = (typeof CUEC_REVIEW_STATUSES)[number];
export type UpdateCuecReviewStatusInput = { review_status: CuecReviewStatus; reason: string | null };

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

  // Clearing back to 'pending' drops the reason — the row must look unreviewed
  // again, and the DB CHECK refuses a pending row that carries reviewer detail.
  if (rs === "pending") reason = null;

  // A GAP MUST BE EXPLAINED. It asserts the organisation fails a control
  // obligation: it creates remediation work, can escalate to the Risk Register,
  // and may be read by an auditor. "Because the tool said so" is not a defence,
  // so the reviewer states why in their own words. The other outcomes are
  // self-explanatory enough that demanding prose would just produce "n/a".
  if (rs === "gap" && (reason === null || reason.trim().length === 0)) {
    return {
      error: "gap_reason_required",
      detail:
        "Recording a gap asserts this organisation does not meet a control the " +
        "vendor requires of it. Say why, so the determination can be defended later."
    };
  }

  return { input: { review_status: rs as CuecReviewStatus, reason } };
}
