/**
 * fieldGroups.ts — presentation-layer grouping of the SOC extraction's flat
 * material-field set into the three sections the document review surface shows:
 *
 *   1. Cover Sheet                          — the "what is this report" facts
 *   2. Complementary User Entity Controls   — the CUEC list
 *   3. Exceptions and Deviations            — auditor exceptions + management responses
 *
 * This grouping is a UI concern, NOT a schema concern. The engine still stores
 * one flat `fields` JSONB document keyed by the closed MATERIAL_FIELD_NAMES set
 * (src/api/lib/socExtractionPrompt.ts). If/when the platform needs to support
 * multiple document types (ISO 27001 certs, pen-test reports, …) with their own
 * section layouts, this map moves down to a schema/registry layer keyed by
 * document type. Until then it lives here so the page stays declarative.
 *
 * FIELD_LABELS is seeded from the `label` strings on MATERIAL_FIELDS in
 * socExtractionPrompt.ts — kept in sync by hand (the engine and app are
 * separate packages; there is no shared import). If a label drifts, the UI
 * falls back to the raw field name.
 */

import type {
  VendorAssuranceExtraction,
  VendorAssuranceExtractedField,
} from "@/lib/api";

/** Cover-sheet fields, in display order. `controls` lives here as the
 * "what was tested" summary rather than getting its own section. */
export const COVER_SHEET_FIELDS = [
  "vendor_name",
  "report_type",
  "report_period_start",
  "report_period_end",
  "report_issued_date",
  "auditor_name",
  "auditor_opinion",
  "trust_services_criteria",
  "subservice_method",
  "subservice_organizations",
  "controls",
] as const;

/** Complementary user entity controls. */
export const CUEC_FIELDS = ["cuecs"] as const;

/** Exceptions / deviations + the management responses keyed back to them. */
export const EXCEPTION_FIELDS = ["exceptions", "management_responses"] as const;

export type VendorAssuranceSectionKey = "coverSheet" | "cuecs" | "exceptions";

/** Human-readable labels, mirrored from MATERIAL_FIELDS[].label. */
export const FIELD_LABELS: Record<string, string> = {
  vendor_name: "Vendor name",
  report_type: "Report type",
  report_period_start: "Report period start",
  report_period_end: "Report period end",
  report_issued_date: "Report issued date",
  auditor_name: "Auditor",
  auditor_opinion: "Auditor opinion",
  trust_services_criteria: "Trust Services Criteria",
  subservice_method: "Subservice method",
  subservice_organizations: "Subservice organizations",
  cuecs: "Complementary user entity controls",
  controls: "Controls",
  exceptions: "Exceptions",
  management_responses: "Management responses",
};

export function fieldLabel(fieldName: string): string {
  return FIELD_LABELS[fieldName] ?? fieldName;
}

export type ExtractionFields = Record<string, VendorAssuranceExtractedField | undefined>;

export type GroupedExtractedFields = {
  coverSheet: Array<{ fieldName: string; field: VendorAssuranceExtractedField | undefined }>;
  /** Raw `cuecs` extracted field (array_of_strings) — may be absent. */
  cuecs: VendorAssuranceExtractedField | undefined;
  /** Raw `exceptions` + `management_responses` extracted fields. */
  exceptions: VendorAssuranceExtractedField | undefined;
  managementResponses: VendorAssuranceExtractedField | undefined;
};

/**
 * Slice a (possibly null) extraction's `fields` map into the three sections.
 * Missing fields are returned as `undefined` rather than omitted, so the UI can
 * render an explicit "—" / "not extracted" affordance per cover-sheet row.
 */
export function groupExtractedFields(
  extraction: VendorAssuranceExtraction | null | undefined
): GroupedExtractedFields {
  const fields: ExtractionFields = (extraction?.fields ?? {}) as ExtractionFields;
  return {
    coverSheet: COVER_SHEET_FIELDS.map((fieldName) => ({ fieldName, field: fields[fieldName] })),
    cuecs: fields["cuecs"],
    exceptions: fields["exceptions"],
    managementResponses: fields["management_responses"],
  };
}

// ---------------------------------------------------------------------------
// Element shapes for the array_of_objects material fields. The engine validator
// only enforces "array of plain objects" — inner keys are best-effort from the
// extraction prompt — so every property here is optional and consumers must
// guard. (See src/api/lib/socExtractionPrompt.ts for the prompted shapes.)
// ---------------------------------------------------------------------------

export type ControlEntry = {
  control_id?: string | null;
  description?: string | null;
  test_procedure?: string | null;
  result?: string | null;
};

export type ExceptionEntry = {
  control_id?: string | null;
  description?: string | null;
  auditor_assessment?: string | null;
};

export type ManagementResponseEntry = {
  exception_ref?: string | null;
  response?: string | null;
};

export function asObjectArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is T => v !== null && typeof v === "object" && !Array.isArray(v));
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
