/**
 * va3CleanSoc2ExtractionRepro.test.ts — a CLEAN SOC 2 must extract.
 *
 * Found by the VA-3 staging operational exercise (2026-08-21), recorded in
 * docs/validation/VA-3-STAGING-EXERCISE.md §4.3. A synthetic SOC 2 uploaded to
 * [SEED] Walkthrough Org on staging failed terminally with
 * `llm_invalid_json / material_field_missing_span: exceptions` and produced
 * zero CUECs, which stops the whole Vendor Assurance workflow at its first step.
 *
 * THE INVARIANT, from socExtractionValidator's own docstring:
 *
 *   "spanned => there is a value to span — a field legitimately absent from the
 *    source document cannot carry a quote, so demanding one is incoherent."
 *
 * That rule was right; the test for it was one word too narrow. It waived the
 * span requirement for `null` only. An EMPTY ARRAY is not null — and for
 * `exceptions`, an empty array is the normal case: a SOC 2 Type II with no
 * testing exceptions is a CLEAN OPINION, the desirable result for a good
 * vendor. There is nothing in such a report to quote for it.
 *
 * So whether a customer's document ingested at all came down to whether the
 * model happened to emit `null` or `[]` for a field meaning "there were none".
 * Nondeterministic model formatting decided whether the product worked.
 *
 * These tests fail against the pre-fix validator and pass after it.
 */
import { describe, it, expect } from "vitest";

import {
  MATERIAL_FIELDS,
  FIELD_NAMES_REQUIRING_SPANS
} from "../lib/socExtractionPrompt.js";
import { validateSocExtraction } from "../lib/socExtractionValidator.js";

/**
 * A complete, otherwise-valid extraction, parameterised on what the model
 * returned for the two fields a clean report has nothing to say about.
 * Every OTHER span-requiring field keeps a real span, so these tests isolate
 * exactly one variable.
 */
const EMPTIED = ["exceptions", "management_responses"] as const;

function buildExtraction(emptyValue: unknown): unknown {
  const fields: Record<string, unknown> = {};
  for (const f of MATERIAL_FIELDS) {
    let value: unknown;
    if ((EMPTIED as readonly string[]).includes(f.name)) value = emptyValue;
    else if (f.shape === "array_of_strings") value = ["Security"];
    else if (f.shape === "array_of_objects") value = [{ description: "a control" }];
    else value = "a scalar value";
    fields[f.name] = { value, confidence: 0.9, status: "extracted" };
  }

  const source_spans = FIELD_NAMES_REQUIRING_SPANS
    .filter((name) => !(EMPTIED as readonly string[]).includes(name))
    .map((name) => ({
      field_name: name,
      page_number: 1,
      char_start: 0,
      char_end: 20,
      quote: "a verbatim excerpt"
    }));

  return { fields, source_spans };
}

describe("VA-3: a clean SOC 2 (no testing exceptions) must extract", () => {
  it("accepts an EMPTY ARRAY for a span-requiring field — nothing to quote", () => {
    const r = validateSocExtraction(buildExtraction([]) as never);

    // Pre-fix this returned { ok: false, error: "material_field_missing_span",
    // detail: "exceptions" }, which is what staging hit.
    expect(r).toMatchObject({ ok: true });
  });

  it("still accepts null for the same field — the original waiver is intact", () => {
    const r = validateSocExtraction(buildExtraction(null) as never);
    expect(r).toMatchObject({ ok: true });
  });

  it("preserves both values verbatim rather than normalising one into the other", () => {
    // [] and null mean different things: "the report says there were none" is
    // not "the report does not address it". The validator must not collapse them.
    const empty = validateSocExtraction(buildExtraction([]) as never);
    const nul = validateSocExtraction(buildExtraction(null) as never);
    expect(empty.ok && empty.extraction.fields["exceptions"]?.value).toEqual([]);
    expect(nul.ok && nul.extraction.fields["exceptions"]?.value).toBeNull();
  });
});

describe("VA-3: the span requirement still bites where it should", () => {
  it("REJECTS a NON-EMPTY material conclusion that carries no span", () => {
    // This is the case the rule exists for: the model asserted findings against
    // the customer's vendor and cited nothing. It must still fail.
    const r = validateSocExtraction(
      buildExtraction([{ description: "Control CC6.1 failed testing" }]) as never
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("material_field_missing_span");
      expect(r.detail).toBe("exceptions");
    }
  });

  it("REJECTS a non-null scalar material conclusion that carries no span", () => {
    // auditor_opinion is a scalar and is never legitimately "empty" — the
    // widened waiver must not reach it.
    const base = buildExtraction(null) as {
      fields: Record<string, unknown>;
      source_spans: Array<{ field_name: string }>;
    };
    base.source_spans = base.source_spans.filter(
      (s) => s.field_name !== "auditor_opinion"
    );
    const r = validateSocExtraction(base as never);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("material_field_missing_span");
      expect(r.detail).toBe("auditor_opinion");
    }
  });
});
