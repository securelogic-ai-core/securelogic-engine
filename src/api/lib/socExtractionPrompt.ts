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

/**
 * ── v3, and why the contract changed (VA-S4-4C-3) ──────────────────────────
 *
 * v2 asked for `management_responses[].exception_ref` while giving an exception
 * NO IDENTITY of its own — only a `control_id`. A response therefore had
 * nothing to reference except a control, and the field's name invited the other
 * reading. Measured in the corpus on 2026-08-31, the model does BOTH: most
 * responses carry a TSC criterion, and one carries the report's own label,
 * "Exception 1". One field, two meanings, no way to tell which.
 *
 * v2 also gave `exceptions[].control_id` a single scalar, so an exception
 * spanning several controls has nowhere to say so. The corpus contains
 * `"CC6.1, CC6.2, CC6.3"` — three identifiers in one string, matching no tested
 * control, invisible to every consumer that keys on the control identifier.
 *
 * v3 corrects both with three keys rather than a rename:
 *   exceptions[].exception_ref            — the report's OWN label
 *   exceptions[].control_refs             — EVERY control the exception affects
 *   management_responses[].control_refs   — the control(s) the response is about
 * and `management_responses[].exception_ref` keeps its name and finally means
 * only what it says.
 *
 * HISTORICAL COMPATIBILITY. v2 extractions are never rewritten. The reader
 * (`parseExceptions` in vendorAssurance/testedControlOutcome.ts) is
 * shape-tolerant and reads both key sets unconditionally, recording on every
 * link which key it came from. `prompt_version` is stored per extraction and is
 * preserved so a past result stays reproducible against the prompt that
 * produced it.
 */
export const PROMPT_VERSION = "soc-extraction-v3";

/**
 * Every extraction contract this system has produced, newest first. Retained so
 * a historical `prompt_version` resolves to a documented shape rather than to a
 * guess, and so a reader can prove it still handles what it claims to.
 */
export const EXTRACTION_CONTRACT_HISTORY = [
  {
    version: "soc-extraction-v3",
    exception_keys: ["exception_ref", "control_refs", "description", "auditor_assessment"],
    management_response_keys: ["exception_ref", "control_refs", "response"],
    note: "exception_ref means an EXCEPTION LABEL on both sides. Control linkage is control_refs, an array.",
  },
  {
    version: "soc-extraction-v2",
    exception_keys: ["control_id", "description", "auditor_assessment"],
    management_response_keys: ["exception_ref", "response"],
    note: "AMBIGUOUS: management_responses[].exception_ref holds a control id OR an exception label, and exceptions[].control_id is a scalar that sometimes packed several identifiers. Read, never rewritten.",
  },
] as const;
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
  { "exception_ref": string|null, "control_refs": [string], "description": string, "auditor_assessment": string|null }

  - "exception_ref" is the REPORT'S OWN LABEL for this exception, exactly as printed — for example "Exception 1", "Deviation 3", "Finding 2". If the report does not label its exceptions, return null. This is NEVER a control identifier.
  - "control_refs" is the list of EVERY tested control identifier this exception affects, one identifier per array element — for example ["CC6.1", "CC6.2", "CC6.3"]. Never join several identifiers into one string. If the report does not say which controls are affected, return an empty array rather than guessing.

For "management_responses" array elements, each object SHOULD include:
  { "exception_ref": string|null, "control_refs": [string], "response": string }

  - "exception_ref" is the label of the EXCEPTION this response addresses, matching an "exception_ref" you returned above. It is NOT a control identifier. Return null if the response names no exception.
  - "control_refs" is the list of tested control identifiers this response is about, one per array element. Return an empty array if the response names none.

Do not infer a link that the report does not state. An empty array is a correct answer; a guessed identifier is not.

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
