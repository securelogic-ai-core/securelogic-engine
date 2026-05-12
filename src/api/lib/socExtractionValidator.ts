/**
 * socExtractionValidator.ts — Strict validator for the LLM extraction response.
 *
 * Phase 1 contract: the validator REJECTS, never coerces. A malformed response
 * surfaces as an extraction_failed:llm_invalid_json document; a re-upload is
 * required (no re-extraction flow).
 *
 * Validates:
 *   - top-level shape { fields: {...}, source_spans: [...] }
 *   - every required material field is present (per MATERIAL_FIELDS)
 *   - confidence is in [0, 1]
 *   - status is exactly "extracted"
 *   - value shape matches MaterialFieldSpec.shape (scalar / array_of_strings /
 *     array_of_objects)
 *   - source_spans have valid char_start/char_end (start>=0, end>=start)
 *   - field_names referenced by spans appear in MATERIAL_FIELDS
 *   - every FIELD_NAMES_REQUIRING_SPANS field has ≥ 1 corresponding span
 *
 * Leniency on empty quotes: source_spans entries whose `quote` is empty or
 * whitespace-only are silently dropped before validation; a field is only
 * rejected if dropping leaves it with zero spans AND it is marked material
 * (material_field_missing_span). A single sloppy span must not sink the whole
 * extraction. Malformed spans (non-object, unknown field_name, bad offsets,
 * bad page_number) are still hard-rejected.
 */

import {
  MATERIAL_FIELDS,
  MATERIAL_FIELD_NAMES,
  FIELD_NAMES_REQUIRING_SPANS,
  getMaterialFieldSpec,
  type MaterialFieldShape
} from "./socExtractionPrompt.js";

const MAX_QUOTE_CHARS = 1024;

export type ValidatedField = {
  value: unknown;
  confidence: number;
  status: "extracted";
};

export type ValidatedSpan = {
  field_name: string;
  page_number: number | null;
  char_start: number;
  char_end: number;
  quote: string;
};

export type ValidatedExtraction = {
  fields: Record<string, ValidatedField>;
  spans: ValidatedSpan[];
};

export type ValidationResult =
  | { ok: true; extraction: ValidatedExtraction }
  | { ok: false; error: string; detail?: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function valueShapeMatches(value: unknown, shape: MaterialFieldShape): boolean {
  if (value === null) return true; // null permitted with confidence 0
  if (shape === "scalar") {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  }
  if (shape === "array_of_strings") {
    return Array.isArray(value) && value.every((v) => typeof v === "string");
  }
  if (shape === "array_of_objects") {
    return Array.isArray(value) && value.every((v) => isPlainObject(v));
  }
  return false;
}

export function validateSocExtraction(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "response_not_object" };
  }

  const fieldsRaw = raw["fields"];
  const spansRaw = raw["source_spans"];

  if (!isPlainObject(fieldsRaw)) {
    return { ok: false, error: "fields_not_object" };
  }
  if (!Array.isArray(spansRaw)) {
    return { ok: false, error: "source_spans_not_array" };
  }

  const fields: Record<string, ValidatedField> = {};

  // Reject unknown field names (no silent accept).
  for (const present of Object.keys(fieldsRaw)) {
    if (!(MATERIAL_FIELD_NAMES as readonly string[]).includes(present)) {
      return { ok: false, error: "unknown_field_name", detail: present };
    }
  }

  // Every required material field must be present and valid.
  for (const spec of MATERIAL_FIELDS) {
    const f = fieldsRaw[spec.name];
    if (!isPlainObject(f)) {
      return { ok: false, error: "field_missing_or_not_object", detail: spec.name };
    }

    const conf = f["confidence"];
    if (typeof conf !== "number" || !Number.isFinite(conf) || conf < 0 || conf > 1) {
      return { ok: false, error: "field_confidence_out_of_range", detail: spec.name };
    }

    const status = f["status"];
    if (status !== "extracted") {
      return { ok: false, error: "field_status_must_be_extracted", detail: spec.name };
    }

    const value = f["value"];
    if (!valueShapeMatches(value, spec.shape)) {
      return { ok: false, error: "field_value_shape_mismatch", detail: spec.name };
    }

    fields[spec.name] = { value, confidence: conf, status: "extracted" };
  }

  // Drop spans whose quote is empty or whitespace-only before validating — a
  // single sloppy span must not sink the whole extraction. If this leaves a
  // span-requiring field with zero spans, that is caught below as
  // material_field_missing_span. Non-object span entries are kept here so the
  // strict check below still hard-rejects them.
  const quoteIsEmpty = (q: unknown): boolean => typeof q !== "string" || q.trim().length === 0;
  const spansForValidation = spansRaw.filter(
    (s) => !(isPlainObject(s) && quoteIsEmpty(s["quote"]))
  );

  // Validate spans.
  const spans: ValidatedSpan[] = [];
  for (let i = 0; i < spansForValidation.length; i++) {
    const s = spansForValidation[i];
    if (!isPlainObject(s)) {
      return { ok: false, error: "span_not_object", detail: `index ${i}` };
    }
    const fieldName = s["field_name"];
    if (typeof fieldName !== "string" || !(MATERIAL_FIELD_NAMES as readonly string[]).includes(fieldName)) {
      return { ok: false, error: "span_field_name_unknown", detail: `index ${i}` };
    }
    const pageRaw = s["page_number"];
    let pageNumber: number | null;
    if (pageRaw === null || pageRaw === undefined) {
      pageNumber = null;
    } else if (typeof pageRaw === "number" && Number.isInteger(pageRaw) && pageRaw > 0) {
      pageNumber = pageRaw;
    } else {
      return { ok: false, error: "span_page_number_invalid", detail: `index ${i}` };
    }
    const charStart = s["char_start"];
    const charEnd = s["char_end"];
    if (typeof charStart !== "number" || !Number.isInteger(charStart) || charStart < 0) {
      return { ok: false, error: "span_char_start_invalid", detail: `index ${i}` };
    }
    if (typeof charEnd !== "number" || !Number.isInteger(charEnd) || charEnd < charStart) {
      return { ok: false, error: "span_char_end_invalid", detail: `index ${i}` };
    }
    // quote is a non-empty string here — empty/whitespace/non-string quotes were
    // filtered out above. The typeof guard narrows for TS and is defensive
    // against a future refactor of the pre-filter.
    const quote = s["quote"];
    if (typeof quote !== "string") continue;
    const quoteTrunc = quote.length > MAX_QUOTE_CHARS ? quote.slice(0, MAX_QUOTE_CHARS) : quote;
    spans.push({
      field_name: fieldName,
      page_number: pageNumber,
      char_start: charStart,
      char_end: charEnd,
      quote: quoteTrunc
    });
  }

  // Material-conclusion fields must each have ≥ 1 span.
  const spannedFields = new Set(spans.map((s) => s.field_name));
  for (const required of FIELD_NAMES_REQUIRING_SPANS) {
    if (!spannedFields.has(required)) {
      return { ok: false, error: "material_field_missing_span", detail: required };
    }
  }

  // For array-of-objects fields where the value is non-null, validate each
  // element is a plain object (already done in valueShapeMatches above for
  // the outer array, but we additionally verify the array isn't a stringly-
  // typed shape for safety).
  for (const spec of MATERIAL_FIELDS) {
    const v = fields[spec.name]?.value;
    if (spec.shape === "array_of_objects" && Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (!isPlainObject(v[i])) {
          return { ok: false, error: "array_element_not_object", detail: `${spec.name}[${i}]` };
        }
      }
    }
  }

  // Validated. Build a fresh, typed extraction so callers can persist directly.
  const _ = getMaterialFieldSpec; // keep import live for tree-shake-resistant builds
  return { ok: true, extraction: { fields, spans } };
}
