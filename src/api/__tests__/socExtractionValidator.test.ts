import { describe, it, expect } from "vitest";
import { validateSocExtraction } from "../lib/socExtractionValidator.js";
import { MATERIAL_FIELDS, FIELD_NAMES_REQUIRING_SPANS } from "../lib/socExtractionPrompt.js";

function fieldStub(value: unknown, confidence = 0.9): { value: unknown; confidence: number; status: "extracted" } {
  return { value, confidence, status: "extracted" };
}

function validValueFor(shape: "scalar" | "array_of_strings" | "array_of_objects"): unknown {
  if (shape === "scalar") return "x";
  if (shape === "array_of_strings") return ["a"];
  return [{ k: "v" }];
}

function buildAllFields(): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const spec of MATERIAL_FIELDS) {
    fields[spec.name] = fieldStub(validValueFor(spec.shape));
  }
  return fields;
}

function buildMinimalSpans(): Array<Record<string, unknown>> {
  return FIELD_NAMES_REQUIRING_SPANS.map((name) => ({
    field_name: name,
    page_number: 1,
    char_start: 0,
    char_end: 10,
    quote: "evidence quote"
  }));
}

describe("validateSocExtraction — happy path", () => {
  it("accepts a fully-formed extraction", () => {
    const r = validateSocExtraction({ fields: buildAllFields(), source_spans: buildMinimalSpans() });
    expect(r.ok).toBe(true);
  });
});

describe("validateSocExtraction — top-level shape", () => {
  it("rejects non-object response", () => {
    expect(validateSocExtraction("not object").ok).toBe(false);
  });
  it("rejects non-object fields", () => {
    expect(validateSocExtraction({ fields: 5, source_spans: [] }).ok).toBe(false);
  });
  it("rejects non-array source_spans", () => {
    expect(validateSocExtraction({ fields: buildAllFields(), source_spans: {} }).ok).toBe(false);
  });
});

describe("validateSocExtraction — field validation", () => {
  it("rejects missing required field", () => {
    const fields = buildAllFields();
    delete fields["auditor_opinion"];
    const r = validateSocExtraction({ fields, source_spans: buildMinimalSpans() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("field_missing_or_not_object");
  });

  it("rejects unknown field name", () => {
    const fields = buildAllFields();
    fields["random_unknown_field"] = fieldStub("x");
    const r = validateSocExtraction({ fields, source_spans: buildMinimalSpans() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unknown_field_name");
  });

  it("rejects out-of-range confidence (>1)", () => {
    const fields = buildAllFields();
    fields["vendor_name"] = fieldStub("x", 1.5);
    const r = validateSocExtraction({ fields, source_spans: buildMinimalSpans() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("field_confidence_out_of_range");
  });

  it("rejects out-of-range confidence (<0)", () => {
    const fields = buildAllFields();
    fields["vendor_name"] = fieldStub("x", -0.1);
    const r = validateSocExtraction({ fields, source_spans: buildMinimalSpans() });
    expect(r.ok).toBe(false);
  });

  it("rejects non-number confidence", () => {
    const fields = buildAllFields();
    fields["vendor_name"] = { value: "x", confidence: "high", status: "extracted" };
    const r = validateSocExtraction({ fields, source_spans: buildMinimalSpans() });
    expect(r.ok).toBe(false);
  });

  it("rejects status != 'extracted'", () => {
    const fields = buildAllFields();
    fields["vendor_name"] = { value: "x", confidence: 0.5, status: "verified" };
    const r = validateSocExtraction({ fields, source_spans: buildMinimalSpans() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("field_status_must_be_extracted");
  });

  it("permits null value with confidence 0", () => {
    const fields = buildAllFields();
    fields["subservice_method"] = fieldStub(null, 0);
    const r = validateSocExtraction({ fields, source_spans: buildMinimalSpans() });
    expect(r.ok).toBe(true);
  });

  it("rejects scalar value where array is required", () => {
    const fields = buildAllFields();
    fields["trust_services_criteria"] = fieldStub("Security");
    const r = validateSocExtraction({ fields, source_spans: buildMinimalSpans() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("field_value_shape_mismatch");
  });

  it("rejects array_of_objects with non-object element", () => {
    const fields = buildAllFields();
    fields["controls"] = fieldStub(["string-not-object"]);
    const r = validateSocExtraction({ fields, source_spans: buildMinimalSpans() });
    expect(r.ok).toBe(false);
  });
});

describe("validateSocExtraction — span validation", () => {
  it("rejects span with char_end < char_start", () => {
    const spans = buildMinimalSpans();
    spans[0]!["char_start"] = 50;
    spans[0]!["char_end"] = 10;
    const r = validateSocExtraction({ fields: buildAllFields(), source_spans: spans });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("span_char_end_invalid");
  });

  it("rejects span with negative char_start", () => {
    const spans = buildMinimalSpans();
    spans[0]!["char_start"] = -1;
    const r = validateSocExtraction({ fields: buildAllFields(), source_spans: spans });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("span_char_start_invalid");
  });

  it("rejects span referencing unknown field_name", () => {
    const spans = buildMinimalSpans();
    spans[0]!["field_name"] = "not_a_field";
    const r = validateSocExtraction({ fields: buildAllFields(), source_spans: spans });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("span_field_name_unknown");
  });

  it("drops an empty/whitespace-quote span; a span-requiring field left with no spans fails material_field_missing_span", () => {
    const spans = buildMinimalSpans();
    spans[0]!["quote"] = "   "; // blank out the only span for FIELD_NAMES_REQUIRING_SPANS[0]
    const r = validateSocExtraction({ fields: buildAllFields(), source_spans: spans });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("material_field_missing_span");
      expect(r.detail).toBe(FIELD_NAMES_REQUIRING_SPANS[0]);
    }
  });

  it("drops an empty-quote span but keeps the field's other valid spans", () => {
    const spans = buildMinimalSpans();
    // Give the first span-requiring field a second, valid span, then blank the first.
    spans.push({
      field_name: FIELD_NAMES_REQUIRING_SPANS[0],
      page_number: 2,
      char_start: 5,
      char_end: 25,
      quote: "a verbatim excerpt"
    });
    spans[0]!["quote"] = "";
    const r = validateSocExtraction({ fields: buildAllFields(), source_spans: spans });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const remaining = r.extraction.spans.filter((s) => s.field_name === FIELD_NAMES_REQUIRING_SPANS[0]);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.quote).toBe("a verbatim excerpt");
    }
  });

  it("drops an empty-quote span on a non-material field without error", () => {
    const spans = buildMinimalSpans();
    // vendor_name is a valid field name that does NOT require a span.
    spans.push({ field_name: "vendor_name", page_number: null, char_start: 0, char_end: 0, quote: "  " });
    const r = validateSocExtraction({ fields: buildAllFields(), source_spans: spans });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.extraction.spans.some((s) => s.field_name === "vendor_name")).toBe(false);
    }
  });

  it("rejects span with non-positive page_number", () => {
    const spans = buildMinimalSpans();
    spans[0]!["page_number"] = 0;
    const r = validateSocExtraction({ fields: buildAllFields(), source_spans: spans });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("span_page_number_invalid");
  });

  it("permits null page_number", () => {
    const spans = buildMinimalSpans();
    spans[0]!["page_number"] = null;
    const r = validateSocExtraction({ fields: buildAllFields(), source_spans: spans });
    expect(r.ok).toBe(true);
  });

  it("truncates over-length quote at insert (1024 chars)", () => {
    const spans = buildMinimalSpans();
    spans[0]!["quote"] = "x".repeat(2000);
    const r = validateSocExtraction({ fields: buildAllFields(), source_spans: spans });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extraction.spans[0]?.quote.length).toBe(1024);
  });
});

describe("validateSocExtraction — material-conclusion span enforcement", () => {
  it("rejects extraction missing a span for a required material-conclusion field", () => {
    // Drop the auditor_opinion span specifically.
    const spans = buildMinimalSpans().filter((s) => s["field_name"] !== "auditor_opinion");
    const r = validateSocExtraction({ fields: buildAllFields(), source_spans: spans });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("material_field_missing_span");
      expect(r.detail).toBe("auditor_opinion");
    }
  });
});
