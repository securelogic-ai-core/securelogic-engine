import { describe, it, expect } from "vitest";
import {
  validateUploadMetadata,
  validateReviewDecisions,
  validateFieldOverrideBody,
  validateRejectBody,
  validateManualReviewBody,
  computeFinalizePrecondition,
  isUuid,
  MAX_BYTE_SIZE,
  MAX_OVERRIDE_REASON
} from "../lib/vendorAssuranceValidation.js";
import { MATERIAL_FIELD_NAMES } from "../lib/socExtractionPrompt.js";

const VENDOR_UUID = "11111111-1111-4111-8111-111111111111";

describe("isUuid", () => {
  it("accepts canonical UUID", () => {
    expect(isUuid(VENDOR_UUID)).toBe(true);
  });
  it("rejects non-UUID strings", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
  });
  it("rejects non-string values", () => {
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("validateUploadMetadata", () => {
  it("accepts valid body + filename", () => {
    const r = validateUploadMetadata({ vendor_id: VENDOR_UUID }, "report.pdf");
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.vendor_id).toBe(VENDOR_UUID);
      expect(r.input.document_type_hint).toBeNull();
      expect(r.input.original_filename).toBe("report.pdf");
    }
  });

  it("accepts valid document_type_hint enum values", () => {
    for (const hint of ["soc1", "soc2_type1", "soc2_type2"]) {
      const r = validateUploadMetadata(
        { vendor_id: VENDOR_UUID, document_type_hint: hint },
        "report.pdf"
      );
      expect("input" in r).toBe(true);
    }
  });

  it("rejects invalid document_type_hint", () => {
    const r = validateUploadMetadata(
      { vendor_id: VENDOR_UUID, document_type_hint: "iso27001" },
      "report.pdf"
    );
    expect(r).toHaveProperty("error", "invalid_document_type_hint");
  });

  it("rejects missing vendor_id", () => {
    const r = validateUploadMetadata({}, "report.pdf");
    expect(r).toHaveProperty("error", "vendor_id_must_be_uuid");
  });

  it("rejects non-UUID vendor_id", () => {
    const r = validateUploadMetadata({ vendor_id: "x" }, "report.pdf");
    expect(r).toHaveProperty("error", "vendor_id_must_be_uuid");
  });

  it("rejects empty filename", () => {
    const r = validateUploadMetadata({ vendor_id: VENDOR_UUID }, "");
    expect(r).toHaveProperty("error", "original_filename_required");
  });

  it("rejects non-object body", () => {
    const r = validateUploadMetadata("not an object", "report.pdf");
    expect(r).toHaveProperty("error", "request_body_must_be_object");
  });

  it("MAX_BYTE_SIZE is 25 MB", () => {
    expect(MAX_BYTE_SIZE).toBe(25 * 1024 * 1024);
  });
});

describe("validateReviewDecisions", () => {
  it("accepts a single accept decision", () => {
    const r = validateReviewDecisions({
      decisions: [{ field_name: "vendor_name", decision: "accept" }]
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.decisions).toHaveLength(1);
      expect(r.input.decisions[0]?.decision).toBe("accept");
      expect(r.input.decisions[0]?.reviewed_value).toBeNull();
    }
  });

  it("accepts a single edit decision with reviewed_value", () => {
    const r = validateReviewDecisions({
      decisions: [
        {
          field_name: "vendor_name",
          decision: "edit",
          reviewed_value: { value: "Acme Inc" }
        }
      ]
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.decisions[0]?.reviewed_value).toEqual({ value: "Acme Inc" });
    }
  });

  it("accepts a single reject decision", () => {
    const r = validateReviewDecisions({
      decisions: [{ field_name: "exceptions", decision: "reject" }]
    });
    expect("input" in r).toBe(true);
  });

  it("accepts multiple decisions in one body", () => {
    const r = validateReviewDecisions({
      decisions: [
        { field_name: "vendor_name", decision: "accept" },
        { field_name: "report_type", decision: "edit", reviewed_value: "SOC 2 Type II" }
      ]
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.decisions).toHaveLength(2);
    }
  });

  it("rejects empty decisions array", () => {
    const r = validateReviewDecisions({ decisions: [] });
    expect(r).toHaveProperty("error", "decisions_must_be_non_empty_array");
  });

  it("rejects missing decisions field", () => {
    const r = validateReviewDecisions({});
    expect(r).toHaveProperty("error", "decisions_must_be_non_empty_array");
  });

  it("rejects unknown field_name", () => {
    const r = validateReviewDecisions({
      decisions: [{ field_name: "not_a_field", decision: "accept" }]
    });
    expect(r).toHaveProperty("error", "unknown_field_name");
  });

  it("rejects unknown decision enum value", () => {
    const r = validateReviewDecisions({
      decisions: [{ field_name: "vendor_name", decision: "approve" }]
    });
    expect(r).toHaveProperty("error", "invalid_decision");
  });

  it("rejects edit without reviewed_value", () => {
    const r = validateReviewDecisions({
      decisions: [{ field_name: "vendor_name", decision: "edit" }]
    });
    expect(r).toHaveProperty("error", "reviewed_value_required_for_edit");
  });

  it("rejects edit with explicit null reviewed_value", () => {
    const r = validateReviewDecisions({
      decisions: [{ field_name: "vendor_name", decision: "edit", reviewed_value: null }]
    });
    expect(r).toHaveProperty("error", "reviewed_value_required_for_edit");
  });

  it("ignores reviewed_value on accept (stores null)", () => {
    const r = validateReviewDecisions({
      decisions: [
        {
          field_name: "vendor_name",
          decision: "accept",
          reviewed_value: { ignored: true }
        }
      ]
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.decisions[0]?.reviewed_value).toBeNull();
    }
  });
});

describe("validateFieldOverrideBody", () => {
  it("accepts a material field + value + reason", () => {
    const r = validateFieldOverrideBody({
      field_name: "vendor_name",
      override_value: "Acme Inc",
      reason: "Legal name on cover page"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.field_name).toBe("vendor_name");
      expect(r.input.override_value).toBe("Acme Inc");
      expect(r.input.reason).toBe("Legal name on cover page");
    }
  });

  it("accepts a null override_value (override to 'none')", () => {
    const r = validateFieldOverrideBody({
      field_name: "subservice_method",
      override_value: null,
      reason: "Not applicable for this report"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.override_value).toBeNull();
  });

  it("accepts an array override_value", () => {
    const r = validateFieldOverrideBody({
      field_name: "trust_services_criteria",
      override_value: ["Security", "Availability"],
      reason: "TSC list corrected"
    });
    expect("input" in r).toBe(true);
  });

  it("rejects unknown field_name", () => {
    const r = validateFieldOverrideBody({ field_name: "not_a_field", override_value: "x", reason: "r" });
    expect(r).toHaveProperty("error", "unknown_field_name");
  });

  it("rejects absent override_value key", () => {
    const r = validateFieldOverrideBody({ field_name: "vendor_name", reason: "r" });
    expect(r).toHaveProperty("error", "override_value_required");
  });

  it("rejects missing / blank / null / non-string reason", () => {
    expect(validateFieldOverrideBody({ field_name: "vendor_name", override_value: "x" })).toHaveProperty("error", "reason_required");
    expect(validateFieldOverrideBody({ field_name: "vendor_name", override_value: "x", reason: "   " })).toHaveProperty("error", "reason_required");
    expect(validateFieldOverrideBody({ field_name: "vendor_name", override_value: "x", reason: null })).toHaveProperty("error", "reason_required");
    expect(validateFieldOverrideBody({ field_name: "vendor_name", override_value: "x", reason: 42 })).toHaveProperty("error", "reason_required");
  });

  it("clamps reason to MAX_OVERRIDE_REASON", () => {
    const r = validateFieldOverrideBody({
      field_name: "vendor_name",
      override_value: "x",
      reason: "a".repeat(MAX_OVERRIDE_REASON + 500)
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reason.length).toBeLessThanOrEqual(MAX_OVERRIDE_REASON);
  });

  it("rejects non-object body", () => {
    expect(validateFieldOverrideBody("nope")).toHaveProperty("error", "request_body_must_be_object");
  });
});

describe("validateRejectBody", () => {
  it("accepts a non-empty reason", () => {
    const r = validateRejectBody({ reason: "Extraction quality too low" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reason).toBe("Extraction quality too low");
  });
  it("rejects missing / blank reason", () => {
    expect(validateRejectBody({})).toHaveProperty("error", "reason_required");
    expect(validateRejectBody({ reason: "" })).toHaveProperty("error", "reason_required");
    expect(validateRejectBody({ reason: "   " })).toHaveProperty("error", "reason_required");
  });
  it("rejects non-object body", () => {
    expect(validateRejectBody(null)).toHaveProperty("error", "request_body_must_be_object");
  });
});

describe("validateManualReviewBody", () => {
  it("accepts a missing body (comment null)", () => {
    const r = validateManualReviewBody(undefined);
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.comment).toBeNull();
  });
  it("accepts an empty object (comment null)", () => {
    const r = validateManualReviewBody({});
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.comment).toBeNull();
  });
  it("accepts a comment string", () => {
    const r = validateManualReviewBody({ comment: "Needs a human pass" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.comment).toBe("Needs a human pass");
  });
  it("normalizes a blank comment to null", () => {
    const r = validateManualReviewBody({ comment: "   " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.comment).toBeNull();
  });
  it("rejects a non-string comment", () => {
    expect(validateManualReviewBody({ comment: 7 })).toHaveProperty("error", "comment_must_be_string");
  });
});

describe("computeFinalizePrecondition", () => {
  it("returns ok when every material field has a current decision", () => {
    const map: Record<string, { decision: "accept" | "edit" | "reject" }> = {};
    for (const name of MATERIAL_FIELD_NAMES) {
      map[name] = { decision: "accept" };
    }
    const r = computeFinalizePrecondition(map);
    expect(r.ok).toBe(true);
  });

  it("returns missing field names when decisions are absent", () => {
    const r = computeFinalizePrecondition({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing_field_names).toEqual([...MATERIAL_FIELD_NAMES]);
    }
  });

  it("returns missing field names when only some are decided", () => {
    const map: Record<string, { decision: "accept" | "edit" | "reject" } | null> = {};
    map["vendor_name"] = { decision: "accept" };
    const r = computeFinalizePrecondition(map);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing_field_names).not.toContain("vendor_name");
      expect(r.missing_field_names.length).toBe(MATERIAL_FIELD_NAMES.length - 1);
    }
  });
});
