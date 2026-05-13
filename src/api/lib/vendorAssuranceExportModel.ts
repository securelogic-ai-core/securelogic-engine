/**
 * vendorAssuranceExportModel.ts — the export bundle's data shapes + the pure,
 * dependency-free derivations and formatters the .xlsx and .pdf exporters share.
 *
 * This module deliberately imports nothing but the closed material-field spec
 * (socExtractionPrompt.ts). It does NOT touch the database, the filesystem, or
 * any network — so the render layer (vendorAssuranceExcelExporter.ts,
 * vendorAssurancePdfExporter.ts) stays a pure function of its input bundle and
 * is unit-testable without a DB.
 *
 * The bundle itself is assembled by buildExportBundle() in
 * vendorAssuranceExportData.ts, which is the only module here that talks to pg.
 *
 * Naming convention follows socExtractionPrompt.ts: "extracted" / "override",
 * never "verified" / "validated".
 */

import {
  MATERIAL_FIELDS,
  type MaterialFieldSpec
} from "./socExtractionPrompt.js";

/* =========================================================
   CUEC rows + control mappings
   ========================================================= */

export interface VendorAssuranceCuecMappingRow {
  id: string;
  cuec_id: string;
  control_id: string;
  mapping_status: "suggested" | "accepted" | "dismissed";
  mapping_score: number | null;
  mapping_source: "auto" | "manual";
  reason: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  control_name: string;
  control_description: string | null;
  control_status: string;
}

export interface VendorAssuranceCuecRow {
  id: string;
  ordinal: number;
  cuec_text: string;
  review_status: "pending" | "reviewed_no_match";
  review_status_reason: string | null;
  review_status_updated_by_user_id: string | null;
  review_status_updated_at: string | null;
  created_at: string;
  updated_at: string;
  mappings: VendorAssuranceCuecMappingRow[];
}

/* =========================================================
   Export bundle types
   ========================================================= */

export type VendorAssuranceReviewState =
  | "extracted"
  | "manual_review_requested"
  | "approved"
  | "rejected"
  | "finalized";

export interface ExtractedFieldValue {
  value: unknown;
  confidence: number | null;
  status?: string;
}

export interface FieldOverrideEntry {
  fieldName: string;
  originalValue: unknown;
  overrideValue: unknown;
  reason: string;
  overriddenByUserId: string | null;
  overriddenByName: string | null;
  overriddenAt: string;
}

export interface ExceptionEntry {
  controlId: string | null;
  description: string;
  auditorAssessment: string | null;
  managementResponse: string | null;
}

export interface ControlEntry {
  controlId: string | null;
  description: string;
  testProcedure: string | null;
  result: string | null;
}

export interface CuecSummary {
  total: number;
  mapped: number;              // ≥1 mapping with mapping_status = 'accepted'
  noApplicableControl: number; // 0 accepted mappings AND review_status = 'reviewed_no_match'
  pending: number;             // everything else
}

export interface VendorAssuranceExportBundle {
  organizationId: string;
  organizationName: string;

  document: {
    id: string;
    vendorId: string;
    originalFilename: string;
    byteSize: number;
    sha256: string;
    documentTypeHint: string | null;
    processingStatus: string;
    uploadedAt: string;             // = vendor_assurance_documents.created_at
    uploadedByUserId: string | null;
    uploadedByName: string | null;
  };

  /** Display name from the platform vendor record (vendors.name); may differ from the SOC report's own naming. */
  vendorRecordName: string | null;

  extraction: {
    id: string;
    modelId: string;
    promptVersion: string;
    createdAt: string;
    fields: Record<string, ExtractedFieldValue | undefined>;
  } | null;

  /** Latest reviewer override per field (DISTINCT ON field_name). */
  fieldOverrides: FieldOverrideEntry[];

  /** Report facts, with the latest field override applied where present. */
  report: {
    vendorName: string | null;
    reportType: string | null;
    reportPeriodStart: string | null;
    reportPeriodEnd: string | null;
    reportIssuedDate: string | null;
    auditorName: string | null;
    auditorOpinion: string | null;
    trustServicesCriteria: string[];
    subserviceMethod: string | null;
    subserviceOrganizations: string[];
  };

  controls: ControlEntry[];
  exceptions: ExceptionEntry[];
  cuecs: VendorAssuranceCuecRow[];
  cuecSummary: CuecSummary;

  /** Point-in-time review state. `state` = the document's current processing_status; the
   *  reviewer/timestamp come from the doc row for approved/finalized and from the latest
   *  matching security_audit_log event for manual_review_requested/rejected. */
  review: {
    state: string;
    reviewerUserId: string | null;
    reviewerName: string | null;
    reviewedAt: string | null;
  };

  export: {
    exportedAt: string;             // ISO; the generation moment
    exportedByUserId: string | null;
    exportedByName: string | null;
  };

  /** UUID → display name, for every user referenced anywhere in the bundle (uploader, reviewers, mappers, …). */
  userNamesById: Record<string, string>;

  /** The closed material-field spec list (so exporters can iterate fields in canonical order). */
  materialFields: readonly MaterialFieldSpec[];
}

/* =========================================================
   Small value coercions (shared with buildExportBundle)
   ========================================================= */

export function asNullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  return String(v);
}

export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x : String(x))).filter((s) => s.trim() !== "");
}

const SPECS_BY_NAME = new Map<string, MaterialFieldSpec>(MATERIAL_FIELDS.map((f) => [f.name, f]));

/** Scalar material fields that hold a date — rendered human-formatted (like the cover), not raw ISO. */
const DATED_FIELD_NAMES = new Set(["report_period_start", "report_period_end", "report_issued_date"]);

/* =========================================================
   CUEC derivations — accepted-mapping-first precedence (decision 5 / refinement 4):
     mapped               := ≥1 mapping with mapping_status = 'accepted'
     noApplicableControl  := 0 accepted mappings AND review_status = 'reviewed_no_match'
     pending              := everything else (review still open; only suggested/dismissed mappings count as nothing)
   ========================================================= */
export function summarizeCuecs(cuecs: VendorAssuranceCuecRow[]): CuecSummary {
  let mapped = 0;
  let noApplicableControl = 0;
  let pending = 0;
  for (const c of cuecs) {
    const hasAccepted = c.mappings.some((m) => m.mapping_status === "accepted");
    if (hasAccepted) mapped += 1;
    else if (c.review_status === "reviewed_no_match") noApplicableControl += 1;
    else pending += 1;
  }
  return { total: cuecs.length, mapped, noApplicableControl, pending };
}

/** Accepted-only mappings for a CUEC, in display order (the customer-deliverable shape — the reviewed state). */
export function acceptedMappings(cuec: VendorAssuranceCuecRow): VendorAssuranceCuecMappingRow[] {
  return cuec.mappings.filter((m) => m.mapping_status === "accepted");
}

/** True when a CUEC's reviewed state is "no applicable control" (0 accepted mappings + explicitly marked). */
export function isNoApplicableControl(cuec: VendorAssuranceCuecRow): boolean {
  return cuec.review_status === "reviewed_no_match" && !cuec.mappings.some((m) => m.mapping_status === "accepted");
}

/** Get the canonical material-field spec for a name (label, shape, span requirement). */
export function materialFieldSpec(name: string): MaterialFieldSpec | undefined {
  return SPECS_BY_NAME.get(name);
}

/* =========================================================
   Shared formatting — used by both export builders so the Excel and PDF
   artifacts read identically. All timestamps are rendered in UTC with an
   explicit "UTC" suffix: locale- and deploy-environment-independent, which is
   what an audit record needs (refinement 1).
   ========================================================= */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

/** "October 1, 2024" (UTC). For values that look like ISO dates or datetimes; passthrough otherwise. */
export function fmtDateUtc(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "October 1, 2024 · 14:22 UTC". */
export function fmtDateTimeUtc(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}

const REVIEW_STATE_LABELS: Record<string, string> = {
  approved: "Approved",
  rejected: "Rejected",
  manual_review_requested: "Manual review requested",
  finalized: "Finalized",
  extracted: "Extracted — awaiting review",
  pending: "Extraction in progress",
  extracting: "Extraction in progress",
  extraction_failed: "Extraction failed"
};
export function reviewStateLabel(state: string): string {
  return REVIEW_STATE_LABELS[state] ?? state;
}

/** Resolve a user UUID to a display name using the bundle's lookup, falling back to "—". */
export function userName(bundle: VendorAssuranceExportBundle, userId: string | null | undefined): string {
  if (!userId) return "—";
  return bundle.userNamesById[userId] ?? "—";
}

/** Best display name for the vendor: the SOC report's own naming, then the platform record, then a generic fallback. */
export function vendorDisplayName(bundle: VendorAssuranceExportBundle): string {
  return bundle.report.vendorName ?? bundle.vendorRecordName ?? "Vendor";
}

/** "{Report Type} — {Vendor}", or a sensible partial when one side is missing. */
export function reportTitle(bundle: VendorAssuranceExportBundle): string {
  const v = vendorDisplayName(bundle);
  return bundle.report.reportType ? `${bundle.report.reportType} — ${v}` : `SOC report — ${v}`;
}

/** Inclusive "Oct 1, 2024 – Sep 30, 2025" when both ends are present, else a short note. */
export function reportPeriodText(bundle: VendorAssuranceExportBundle): string {
  const { reportPeriodStart, reportPeriodEnd } = bundle.report;
  if (reportPeriodStart && reportPeriodEnd) return `${fmtDateUtc(reportPeriodStart)} – ${fmtDateUtc(reportPeriodEnd)}`;
  if (reportPeriodEnd) return `as of ${fmtDateUtc(reportPeriodEnd)}`;
  if (reportPeriodStart) return `from ${fmtDateUtc(reportPeriodStart)}`;
  return "period not on record";
}

/** "18 mapped to controls · 3 no applicable control · 2 pending  (23 total)". */
export function cuecSummaryText(bundle: VendorAssuranceExportBundle): string {
  const s = bundle.cuecSummary;
  return `${s.mapped} mapped to controls · ${s.noApplicableControl} no applicable control · ${s.pending} pending  (${s.total} total)`;
}

/** "{stateLabel} · {reviewer} · {timestamp}" — point-in-time; reviewer/timestamp omitted when unknown. */
export function reviewLine(bundle: VendorAssuranceExportBundle): string {
  const label = reviewStateLabel(bundle.review.state);
  const parts: string[] = [label];
  if (bundle.review.reviewerName) parts.push(bundle.review.reviewerName);
  if (bundle.review.reviewedAt) parts.push(fmtDateTimeUtc(bundle.review.reviewedAt));
  return parts.join(" · ");
}

/** Decision-7 "what this document represents" statement, with the org name and report title woven in. */
export function coverStatementText(bundle: VendorAssuranceExportBundle): string {
  const org = bundle.organizationName;
  return (
    `This document is a record of ${org}'s review of the SOC report titled "${reportTitle(bundle)}", ` +
    `as of ${fmtDateTimeUtc(bundle.export.exportedAt)}. ` +
    `Field corrections and CUEC-to-control mappings reflect ${org}'s reviewer decisions and are auditable in the SecureLogic platform.`
  );
}

/** Slugify a string for use in a download filename: lowercase ASCII, runs of other chars → "-". */
function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "vendor";
}

/** "<vendor>-<as-of-date>-soc-review" — the base (no extension) for export downloads. */
export function exportFilenameBase(bundle: VendorAssuranceExportBundle): string {
  const vendorSlug = slugify(bundle.report.vendorName ?? bundle.vendorRecordName ?? "vendor");
  // "as of" = report period end (Type II) or report issued date (Type I); fall back to export date.
  const asOfRaw = bundle.report.reportPeriodEnd ?? bundle.report.reportIssuedDate ?? bundle.export.exportedAt;
  const asOf = new Date(asOfRaw);
  const asOfStr = Number.isNaN(asOf.getTime())
    ? new Date(bundle.export.exportedAt).toISOString().slice(0, 10)
    : `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, "0")}-${String(asOf.getUTCDate()).padStart(2, "0")}`;
  return `${vendorSlug}-${asOfStr}-soc-review`;
}

/**
 * Render a material field's value as a single human-readable string for the
 * Document Fields surfaces. Scalars pass through; array-of-strings join with
 * "; "; array-of-objects collapse to a count, with a cross-reference for the
 * fields that have their own dedicated surface (cuecs, exceptions).
 */
export function renderFieldValueForDisplay(fieldName: string, value: unknown): string {
  if (value === null || value === undefined) return "—";

  // Dated scalar fields render the same human-formatted way the cover does (e.g. "October 1, 2024"),
  // so an auditor doesn't see the cover and the Document Fields surface disagree. fmtDateUtc passes
  // a value that doesn't parse as a date straight through.
  if (DATED_FIELD_NAMES.has(fieldName) && typeof value === "string") return fmtDateUtc(value);

  // CUECs are stored as an array of strings but have their own dedicated surface,
  // so this must be checked before the generic array-of-strings join below.
  if (fieldName === "cuecs") {
    const arr = asStringArray(value);
    return arr.length === 0 ? "None reported" : `${arr.length} CUEC${arr.length === 1 ? "" : "s"} (see the CUECs sheet)`;
  }

  const spec = SPECS_BY_NAME.get(fieldName);
  const shape = spec?.shape;

  if (shape === "array_of_strings" || (shape === undefined && Array.isArray(value) && value.every((x) => typeof x === "string"))) {
    const arr = asStringArray(value);
    return arr.length === 0 ? "—" : arr.join("; ");
  }

  if (shape === "array_of_objects" || (shape === undefined && Array.isArray(value))) {
    const n = Array.isArray(value) ? value.length : 0;
    if (fieldName === "exceptions") return n === 0 ? "None reported" : `${n} exception${n === 1 ? "" : "s"} (see the Exceptions sheet)`;
    if (fieldName === "controls") return n === 0 ? "—" : `${n} control${n === 1 ? "" : "s"} tested (see the source SOC report for the full controls matrix)`;
    if (fieldName === "management_responses") return n === 0 ? "None" : `${n} management response${n === 1 ? "" : "s"}`;
    return n === 0 ? "—" : `${n} item${n === 1 ? "" : "s"}`;
  }

  if (typeof value === "string") return value.trim() === "" ? "—" : value;
  return String(value);
}
