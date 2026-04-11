import { describe, it, expect } from "vitest";
import { validateVendorAssessmentCreate } from "../lib/vendorAssessmentValidation.js";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_VENDOR_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ----------------------------------------------------------------
// Body shape
// ----------------------------------------------------------------

describe("validateVendorAssessmentCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateVendorAssessmentCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateVendorAssessmentCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateVendorAssessmentCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ----------------------------------------------------------------
// vendor_id
// ----------------------------------------------------------------

describe("validateVendorAssessmentCreate — vendor_id", () => {
  it("rejects missing vendor_id", () => {
    const r = validateVendorAssessmentCreate({
      assessment_type: "annual",
      overall_severity: "High"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_required");
  });

  it("rejects empty vendor_id", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: "",
      assessment_type: "annual",
      overall_severity: "High"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_required");
  });

  it("rejects non-UUID vendor_id", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: "not-a-uuid",
      assessment_type: "annual",
      overall_severity: "High"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_must_be_uuid");
  });

  it("accepts a valid UUID vendor_id", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBe(VALID_VENDOR_UUID);
  });
});

// ----------------------------------------------------------------
// assessment_type
// ----------------------------------------------------------------

describe("validateVendorAssessmentCreate — assessment_type", () => {
  it("rejects missing assessment_type", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      overall_severity: "High"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("assessment_type_required");
  });

  it("rejects empty assessment_type", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "   ",
      overall_severity: "High"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("assessment_type_required");
  });

  it("accepts assessment_type and trims it", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "  annual review  ",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.assessment_type).toBe("annual review");
  });
});

// ----------------------------------------------------------------
// overall_severity
// ----------------------------------------------------------------

describe("validateVendorAssessmentCreate — overall_severity", () => {
  it("rejects missing overall_severity", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("rejects invalid overall_severity", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "Extreme"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it("rejects lowercase severity", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "high"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it("accepts Critical", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "Critical"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Critical");
  });

  it("accepts High", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("High");
  });

  it("accepts Moderate", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Moderate");
  });

  it("accepts Low", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "Low"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Low");
  });
});

// ----------------------------------------------------------------
// summary
// ----------------------------------------------------------------

describe("validateVendorAssessmentCreate — summary", () => {
  it("defaults to null when not provided", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("accepts null summary", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      summary: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("accepts a string summary", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      summary: "  Vendor passed basic controls.  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBe("Vendor passed basic controls.");
  });

  it("rejects non-string, non-null summary", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      summary: 42
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("summary_must_be_string_or_null");
  });
});

// ----------------------------------------------------------------
// notes
// ----------------------------------------------------------------

describe("validateVendorAssessmentCreate — notes", () => {
  it("defaults to null when not provided", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts null notes", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      notes: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts a string notes value", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      notes: "Reviewed SOC2 report."
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBe("Reviewed SOC2 report.");
  });

  it("rejects non-string, non-null notes", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      notes: true
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_must_be_string_or_null");
  });
});

// ----------------------------------------------------------------
// performed_at
// ----------------------------------------------------------------

describe("validateVendorAssessmentCreate — performed_at", () => {
  it("defaults to null when not provided", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts null performed_at", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      performed_at: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts a valid ISO date string", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      performed_at: "2026-03-15"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBe("2026-03-15");
  });

  it("rejects malformed date string", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      performed_at: "March 15, 2026"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_invalid_format");
  });

  it("rejects non-string performed_at", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      performed_at: 20260315
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_must_be_date_string_or_null");
  });
});

// ----------------------------------------------------------------
// reviewer_id
// ----------------------------------------------------------------

describe("validateVendorAssessmentCreate — reviewer_id", () => {
  it("defaults to null when not provided", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("accepts null reviewer_id", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      reviewer_id: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("rejects non-UUID reviewer_id", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      reviewer_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });

  it("accepts a valid UUID reviewer_id", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High",
      reviewer_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });
});

// ----------------------------------------------------------------
// Minimal and full valid bodies
// ----------------------------------------------------------------

describe("validateVendorAssessmentCreate — minimal valid body", () => {
  it("accepts required fields only", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.vendor_id).toBe(VALID_VENDOR_UUID);
      expect(r.input.assessment_type).toBe("annual");
      expect(r.input.overall_severity).toBe("High");
      expect(r.input.summary).toBeNull();
      expect(r.input.notes).toBeNull();
      expect(r.input.performed_at).toBeNull();
      expect(r.input.reviewer_id).toBeNull();
    }
  });
});

describe("validateVendorAssessmentCreate — full valid body", () => {
  it("accepts all fields populated", () => {
    const r = validateVendorAssessmentCreate({
      vendor_id: VALID_VENDOR_UUID,
      assessment_type: "annual",
      overall_severity: "Critical",
      summary: "Significant gaps found in access control.",
      notes: "SOC2 report reviewed. Findings shared with vendor.",
      performed_at: "2026-04-01",
      reviewer_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.vendor_id).toBe(VALID_VENDOR_UUID);
      expect(r.input.assessment_type).toBe("annual");
      expect(r.input.overall_severity).toBe("Critical");
      expect(r.input.summary).toBe("Significant gaps found in access control.");
      expect(r.input.notes).toBe("SOC2 report reviewed. Findings shared with vendor.");
      expect(r.input.performed_at).toBe("2026-04-01");
      expect(r.input.reviewer_id).toBe(VALID_UUID);
    }
  });
});
