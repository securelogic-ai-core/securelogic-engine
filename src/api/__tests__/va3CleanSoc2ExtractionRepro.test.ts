import { describe, it, expect } from "vitest";
import { validateSocExtraction } from "../lib/socExtractionValidator.js";
import { MATERIAL_FIELDS } from "../lib/socExtractionPrompt.js";

// Build a complete, otherwise-valid extraction, parameterised on what the model
// returned for `exceptions` / `management_responses`.
function build(emptyAs: null | []) {
  const fields: Record<string, unknown> = {};
  for (const f of MATERIAL_FIELDS) {
    let value: unknown;
    if (f.name === "exceptions" || f.name === "management_responses") value = emptyAs;
    else if (f.shape === "array_of_strings") value = ["x"];
    else if (f.shape === "array_of_objects") value = [{ description: "d" }];
    else value = "v";
    fields[f.name] = { value, confidence: 0.9, status: "extracted" };
  }
  // A span for every span-requiring field EXCEPT the two we emptied — there is
  // nothing in a clean report to quote for them.
  const spans = MATERIAL_FIELDS
    .filter((f) => f.requiresSourceSpan && f.name !== "exceptions" && f.name !== "management_responses")
    .map((f) => ({ field_name: f.name, page_number: 1, char_start: 0, char_end: 10, quote: "verbatim" }));
  return { fields, source_spans: spans };
}

describe("VA-3 repro: a CLEAN SOC 2 (no testing exceptions)", () => {
  it("model returns null for exceptions -> extraction SUCCEEDS", () => {
    const r = validateSocExtraction(build(null) as never);
    expect(r.ok).toBe(true);
  });

  it("model returns [] for exceptions -> extraction FAILS material_field_missing_span", () => {
    const r = validateSocExtraction(build([]) as never);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("material_field_missing_span");
      expect(r.detail).toBe("exceptions");
    }
  });
});
