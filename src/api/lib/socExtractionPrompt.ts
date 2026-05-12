/**
 * socExtractionPrompt.ts — Closed material-field set + extraction prompt.
 *
 * The MATERIAL_FIELDS list is the single source of truth for:
 *   1. socExtractionValidator.ts (which fields must be present, which require spans)
 *   2. socExtractionPrompt (which fields the LLM is asked to extract)
 *   3. vendorAssuranceValidation.finalize precondition (every material field
 *      must have a current decision before finalize succeeds)
 *   4. UI per-field cards (one card per material field)
 *
 * Adding a field requires updating this list and bumping PROMPT_VERSION.
 * Removing a field is a behavior change — historical extractions retain their
 * previous shape because the JSONB schema is enforced at insert time, not at
 * read time.
 *
 * Naming uses "extracted" only — never "verified" or "validated".
 */

export const PROMPT_VERSION = "soc-extraction-v2";
export const MODEL_ID = "claude-sonnet-4-6";

/** Field shape: scalar value vs array-of-strings vs array-of-objects. */
export type MaterialFieldShape = "scalar" | "array_of_strings" | "array_of_objects";

export type MaterialFieldSpec = {
  name: string;
  shape: MaterialFieldShape;
  /** True for fields whose extraction must carry at least one source span. */
  requiresSourceSpan: boolean;
  /** Human-readable label for UI. */
  label: string;
};

export const MATERIAL_FIELDS: readonly MaterialFieldSpec[] = [
  { name: "vendor_name",            shape: "scalar",            requiresSourceSpan: false, label: "Vendor name" },
  { name: "report_type",            shape: "scalar",            requiresSourceSpan: true,  label: "Report type" },
  { name: "report_period_start",    shape: "scalar",            requiresSourceSpan: true,  label: "Report period start" },
  { name: "report_period_end",      shape: "scalar",            requiresSourceSpan: true,  label: "Report period end" },
  { name: "report_issued_date",     shape: "scalar",            requiresSourceSpan: true,  label: "Report issued date" },
  { name: "auditor_name",           shape: "scalar",            requiresSourceSpan: true,  label: "Auditor" },
  { name: "auditor_opinion",        shape: "scalar",            requiresSourceSpan: true,  label: "Auditor opinion" },
  { name: "trust_services_criteria",shape: "array_of_strings",  requiresSourceSpan: true,  label: "Trust Services Criteria" },
  { name: "subservice_method",      shape: "scalar",            requiresSourceSpan: false, label: "Subservice method" },
  { name: "subservice_organizations", shape: "array_of_strings", requiresSourceSpan: false, label: "Subservice organizations" },
  { name: "cuecs",                  shape: "array_of_strings",  requiresSourceSpan: false, label: "Complementary user entity controls" },
  { name: "controls",               shape: "array_of_objects",  requiresSourceSpan: false, label: "Controls" },
  { name: "exceptions",             shape: "array_of_objects",  requiresSourceSpan: true,  label: "Exceptions" },
  { name: "management_responses",   shape: "array_of_objects",  requiresSourceSpan: true,  label: "Management responses" }
] as const;

export const MATERIAL_FIELD_NAMES: readonly string[] = MATERIAL_FIELDS.map((f) => f.name);

export const FIELD_NAMES_REQUIRING_SPANS: readonly string[] = MATERIAL_FIELDS
  .filter((f) => f.requiresSourceSpan)
  .map((f) => f.name);

export function isMaterialFieldName(name: string): boolean {
  return (MATERIAL_FIELD_NAMES as readonly string[]).includes(name);
}

export function getMaterialFieldSpec(name: string): MaterialFieldSpec | null {
  return MATERIAL_FIELDS.find((f) => f.name === name) ?? null;
}

/**
 * Build the extraction prompt for one document. Single-org by construction —
 * the caller passes one document's text and one organizationId; this prompt
 * never batches across orgs (TENANT_ISOLATION_STANDARD.md §6).
 *
 * Truncation: text is truncated at TEXT_BUDGET_CHARS to stay within model
 * context. Document_type_hint, when supplied, is rendered at the top so the
 * model can prefer its conventions.
 */
export const TEXT_BUDGET_CHARS = 60_000;

export function buildSocExtractionPrompt(args: {
  documentText: string;
  documentTypeHint: string | null;
}): string {
  const excerpt = args.documentText.slice(0, TEXT_BUDGET_CHARS).replace(/\n{3,}/g, "\n\n").trim();
  const hintLine = args.documentTypeHint
    ? `Document type hinted by uploader: ${args.documentTypeHint}.`
    : "Document type was not hinted; identify it from the content.";

  const fieldList = MATERIAL_FIELDS
    .map((f) => {
      const shapeNote =
        f.shape === "array_of_strings"
          ? " (array of strings)"
          : f.shape === "array_of_objects"
            ? " (array of objects with fields described below)"
            : "";
      const spanNote = f.requiresSourceSpan ? " — REQUIRES at least one source_spans entry" : "";
      return `  - ${f.name}${shapeNote}${spanNote}`;
    })
    .join("\n");

  return `You are a senior third-party risk analyst extracting structured fields from a SOC report.

${hintLine}

Document text:
---
${excerpt}
---

Extract the following material fields. For every field, return:
  - "value":      the extracted value (string, ISO date string, or array as noted)
  - "confidence": a number in [0, 1] reflecting how confident you are in the extraction
  - "status":     the literal string "extracted"

If a field is genuinely not present in the document, return value: null and confidence: 0.

Material fields:
${fieldList}

For "controls" array elements, each object SHOULD include:
  { "control_id": string|null, "description": string, "test_procedure": string|null, "result": string|null }

For "exceptions" array elements, each object SHOULD include:
  { "control_id": string|null, "description": string, "auditor_assessment": string|null }

For "management_responses" array elements, each object SHOULD include:
  { "exception_ref": string|null, "response": string }

Also return a "source_spans" array on the top-level object. Each span:
  { "field_name": string, "page_number": int|null, "char_start": int, "char_end": int, "quote": string (≤ 800 chars) }

For each source_spans entry, the "quote" field MUST be a non-empty verbatim excerpt from the document text above, copied character-for-character including punctuation and capitalization. If you cannot find a verbatim quote for a given field, omit that span entry entirely rather than emitting an empty quote string. Empty or placeholder quotes cause the extraction to be discarded.

Every field listed above as "REQUIRES at least one source_spans entry" MUST have at least one matching span.

Return valid JSON only — no markdown, no code fences, no commentary. Top-level shape:
{
  "fields": { "<field_name>": { "value": ..., "confidence": ..., "status": "extracted" }, ... },
  "source_spans": [ ... ]
}`;
}
