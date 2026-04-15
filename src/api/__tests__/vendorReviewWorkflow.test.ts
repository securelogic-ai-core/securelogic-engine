import { describe, it, expect } from "vitest";
import {
  validateVendorReviewCreate,
  validateVendorReviewStatusTransition,
  TERMINAL_STATUSES,
  FINDING_STATUSES,
  VALID_TRANSITIONS,
  isValidTransition
} from "../lib/vendorReviewValidation.js";

// ====================================================================
// Helpers
// ====================================================================

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function minimalCreate() {
  return { vendor_id: VALID_UUID };
}

function validCreate(overrides: Record<string, unknown> = {}) {
  return { ...minimalCreate(), ...overrides };
}

// ====================================================================
// FINDING_STATUSES export
// ====================================================================

describe("FINDING_STATUSES", () => {
  it("includes concerns_identified", () => {
    expect(FINDING_STATUSES.has("concerns_identified")).toBe(true);
  });

  it("includes critical_issues", () => {
    expect(FINDING_STATUSES.has("critical_issues")).toBe(true);
  });

  it("does not include satisfactory", () => {
    expect(FINDING_STATUSES.has("satisfactory")).toBe(false);
  });

  it("does not include not_started", () => {
    expect(FINDING_STATUSES.has("not_started")).toBe(false);
  });

  it("does not include in_progress", () => {
    expect(FINDING_STATUSES.has("in_progress")).toBe(false);
  });
});

// ====================================================================
// validateVendorReviewCreate — body shape
// ====================================================================

describe("validateVendorReviewCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateVendorReviewCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateVendorReviewCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects non-object body", () => {
    const r = validateVendorReviewCreate("string");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("accepts minimal valid body", () => {
    const r = validateVendorReviewCreate(minimalCreate());
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateVendorReviewCreate — vendor_id
// ====================================================================

describe("validateVendorReviewCreate — vendor_id", () => {
  it("rejects missing vendor_id", () => {
    const r = validateVendorReviewCreate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_required");
  });

  it("rejects empty vendor_id", () => {
    const r = validateVendorReviewCreate({ vendor_id: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_required");
  });

  it("rejects non-UUID vendor_id", () => {
    const r = validateVendorReviewCreate({ vendor_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_must_be_uuid");
  });

  it("accepts valid UUID vendor_id", () => {
    const r = validateVendorReviewCreate(minimalCreate());
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBe(VALID_UUID);
  });
});

// ====================================================================
// validateVendorReviewCreate — status
// ====================================================================

describe("validateVendorReviewCreate — status", () => {
  it("defaults status to 'not_started' when absent", () => {
    const r = validateVendorReviewCreate(minimalCreate());
    if ("input" in r) expect(r.input.status).toBe("not_started");
  });

  it("rejects empty status", () => {
    const r = validateVendorReviewCreate(validCreate({ status: "" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_must_be_non_empty_string");
  });

  it("rejects invalid status", () => {
    const r = validateVendorReviewCreate(validCreate({ status: "unknown" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it.each(["not_started", "in_progress", "satisfactory", "concerns_identified", "critical_issues"])(
    "accepts status=%s",
    (s) => {
      const r = validateVendorReviewCreate(validCreate({ status: s }));
      expect("input" in r).toBe(true);
    }
  );
});

// ====================================================================
// validateVendorReviewCreate — overall_severity (optional at POST)
// ====================================================================

describe("validateVendorReviewCreate — overall_severity", () => {
  it("defaults to null when absent", () => {
    const r = validateVendorReviewCreate(minimalCreate());
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("accepts null overall_severity", () => {
    const r = validateVendorReviewCreate(validCreate({ overall_severity: null }));
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("rejects invalid overall_severity", () => {
    const r = validateVendorReviewCreate(validCreate({ overall_severity: "Extreme" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it("rejects non-string non-null overall_severity", () => {
    const r = validateVendorReviewCreate(validCreate({ overall_severity: 42 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_must_be_string_or_null");
  });

  it.each(["Critical", "High", "Moderate", "Low"])("accepts severity=%s", (sev) => {
    const r = validateVendorReviewCreate(validCreate({ overall_severity: sev }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe(sev);
  });

  // overall_severity is NOT required at POST even for finding-triggering statuses
  it("does not require overall_severity when status=concerns_identified at POST", () => {
    const r = validateVendorReviewCreate(validCreate({ status: "concerns_identified" }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("does not require overall_severity when status=critical_issues at POST", () => {
    const r = validateVendorReviewCreate(validCreate({ status: "critical_issues" }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });
});

// ====================================================================
// validateVendorReviewCreate — optional string fields
// ====================================================================

describe("validateVendorReviewCreate — optional string fields", () => {
  it("defaults summary to null when absent", () => {
    const r = validateVendorReviewCreate(minimalCreate());
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("rejects non-string summary", () => {
    const r = validateVendorReviewCreate(validCreate({ summary: 42 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("summary_must_be_string_or_null");
  });

  it("normalizes whitespace-only summary to null", () => {
    const r = validateVendorReviewCreate(validCreate({ summary: "   " }));
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("trims and accepts valid summary", () => {
    const r = validateVendorReviewCreate(validCreate({ summary: "  Vendor looks risky  " }));
    if ("input" in r) expect(r.input.summary).toBe("Vendor looks risky");
  });

  it("defaults notes to null when absent", () => {
    const r = validateVendorReviewCreate(minimalCreate());
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("rejects non-string notes", () => {
    const r = validateVendorReviewCreate(validCreate({ notes: true }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_must_be_string_or_null");
  });

  it("accepts string notes", () => {
    const r = validateVendorReviewCreate(validCreate({ notes: "Awaiting SOC 2" }));
    if ("input" in r) expect(r.input.notes).toBe("Awaiting SOC 2");
  });
});

// ====================================================================
// validateVendorReviewCreate — performed_at
// ====================================================================

describe("validateVendorReviewCreate — performed_at", () => {
  it("defaults to null when absent", () => {
    const r = validateVendorReviewCreate(minimalCreate());
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts ISO date string", () => {
    const r = validateVendorReviewCreate(validCreate({ performed_at: "2026-04-13" }));
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-13");
  });

  it("rejects invalid date format", () => {
    const r = validateVendorReviewCreate(validCreate({ performed_at: "April 13 2026" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_invalid_format");
  });

  it("rejects non-string performed_at", () => {
    const r = validateVendorReviewCreate(validCreate({ performed_at: 20260413 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_must_be_date_string_or_null");
  });

  it("accepts null performed_at", () => {
    const r = validateVendorReviewCreate(validCreate({ performed_at: null }));
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });
});

// ====================================================================
// validateVendorReviewCreate — reviewer_id
// ====================================================================

describe("validateVendorReviewCreate — reviewer_id", () => {
  it("defaults to null when absent", () => {
    const r = validateVendorReviewCreate(minimalCreate());
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("accepts valid UUID reviewer_id", () => {
    const r = validateVendorReviewCreate(validCreate({ reviewer_id: VALID_UUID }));
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });

  it("rejects non-UUID reviewer_id", () => {
    const r = validateVendorReviewCreate(validCreate({ reviewer_id: "user@example.com" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });

  it("accepts null reviewer_id", () => {
    const r = validateVendorReviewCreate(validCreate({ reviewer_id: null }));
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });
});

// ====================================================================
// validateVendorReviewStatusTransition — body shape
// ====================================================================

describe("validateVendorReviewStatusTransition — body shape", () => {
  it("rejects null body", () => {
    const r = validateVendorReviewStatusTransition(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateVendorReviewStatusTransition([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects missing status", () => {
    const r = validateVendorReviewStatusTransition({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_required");
  });

  it("rejects empty status", () => {
    const r = validateVendorReviewStatusTransition({ status: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_required");
  });

  it("rejects invalid status", () => {
    const r = validateVendorReviewStatusTransition({ status: "blocked" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts satisfactory status without severity", () => {
    const r = validateVendorReviewStatusTransition({ status: "satisfactory" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });
});

// ====================================================================
// validateVendorReviewStatusTransition — severity gating (REQUIRED at PATCH)
// ====================================================================

describe("validateVendorReviewStatusTransition — severity gating", () => {
  it("requires overall_severity when status=concerns_identified", () => {
    const r = validateVendorReviewStatusTransition({ status: "concerns_identified" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("requires overall_severity when status=critical_issues", () => {
    const r = validateVendorReviewStatusTransition({ status: "critical_issues" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("rejects null overall_severity for finding-triggering status", () => {
    const r = validateVendorReviewStatusTransition({
      status: "concerns_identified",
      overall_severity: null
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("rejects invalid severity on finding-triggering status", () => {
    const r = validateVendorReviewStatusTransition({
      status: "concerns_identified",
      overall_severity: "Extreme"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it.each(["Critical", "High", "Moderate", "Low"])(
    "accepts severity=%s on concerns_identified transition",
    (sev) => {
      const r = validateVendorReviewStatusTransition({
        status: "concerns_identified",
        overall_severity: sev
      });
      expect("input" in r).toBe(true);
      if ("input" in r) expect(r.input.overall_severity).toBe(sev);
    }
  );

  it("accepts severity on critical_issues transition", () => {
    const r = validateVendorReviewStatusTransition({
      status: "critical_issues",
      overall_severity: "Critical"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("critical_issues");
      expect(r.input.overall_severity).toBe("Critical");
    }
  });

  it("allows optional severity on non-finding-triggering statuses", () => {
    const r = validateVendorReviewStatusTransition({
      status: "in_progress",
      overall_severity: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Moderate");
  });

  it("allows absent severity on not_started", () => {
    const r = validateVendorReviewStatusTransition({ status: "not_started" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("rejects invalid severity on non-finding-triggering status", () => {
    const r = validateVendorReviewStatusTransition({
      status: "in_progress",
      overall_severity: "Extreme"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });
});

// ====================================================================
// validateVendorReviewStatusTransition — optional fields
// ====================================================================

describe("validateVendorReviewStatusTransition — optional fields", () => {
  it("passes summary through", () => {
    const r = validateVendorReviewStatusTransition({
      status: "concerns_identified",
      overall_severity: "High",
      summary: "Vendor failed security review"
    });
    if ("input" in r) expect(r.input.summary).toBe("Vendor failed security review");
  });

  it("normalizes whitespace-only summary to null", () => {
    const r = validateVendorReviewStatusTransition({
      status: "satisfactory",
      summary: "   "
    });
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("rejects non-string notes", () => {
    const r = validateVendorReviewStatusTransition({
      status: "satisfactory",
      notes: 123
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_must_be_string_or_null");
  });

  it("accepts string notes", () => {
    const r = validateVendorReviewStatusTransition({
      status: "satisfactory",
      notes: "All controls verified"
    });
    if ("input" in r) expect(r.input.notes).toBe("All controls verified");
  });

  it("accepts performed_at ISO date", () => {
    const r = validateVendorReviewStatusTransition({
      status: "satisfactory",
      performed_at: "2026-04-13"
    });
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-13");
  });

  it("rejects invalid performed_at format", () => {
    const r = validateVendorReviewStatusTransition({
      status: "satisfactory",
      performed_at: "13/04/2026"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_invalid_format");
  });

  it("accepts reviewer_id UUID", () => {
    const r = validateVendorReviewStatusTransition({
      status: "satisfactory",
      reviewer_id: VALID_UUID
    });
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });

  it("rejects non-UUID reviewer_id", () => {
    const r = validateVendorReviewStatusTransition({
      status: "satisfactory",
      reviewer_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });

  it("accepts null reviewer_id", () => {
    const r = validateVendorReviewStatusTransition({
      status: "satisfactory",
      reviewer_id: null
    });
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("defaults all optional fields to null when absent", () => {
    const r = validateVendorReviewStatusTransition({ status: "in_progress" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.overall_severity).toBeNull();
      expect(r.input.summary).toBeNull();
      expect(r.input.notes).toBeNull();
      expect(r.input.performed_at).toBeNull();
      expect(r.input.reviewer_id).toBeNull();
    }
  });
});

// ====================================================================
// TERMINAL_STATUSES export
// ====================================================================

describe("TERMINAL_STATUSES", () => {
  it("includes satisfactory", () => {
    expect(TERMINAL_STATUSES.has("satisfactory")).toBe(true);
  });

  it("includes concerns_identified", () => {
    expect(TERMINAL_STATUSES.has("concerns_identified")).toBe(true);
  });

  it("includes critical_issues", () => {
    expect(TERMINAL_STATUSES.has("critical_issues")).toBe(true);
  });

  it("does not include not_started", () => {
    expect(TERMINAL_STATUSES.has("not_started")).toBe(false);
  });

  it("does not include in_progress", () => {
    expect(TERMINAL_STATUSES.has("in_progress")).toBe(false);
  });
});

// ====================================================================
// VALID_TRANSITIONS export
// ====================================================================

describe("VALID_TRANSITIONS", () => {
  it("not_started can only transition to in_progress", () => {
    expect(VALID_TRANSITIONS["not_started"]).toEqual(["in_progress"]);
  });

  it("in_progress can transition to all three terminal states", () => {
    expect(VALID_TRANSITIONS["in_progress"]).toContain("satisfactory");
    expect(VALID_TRANSITIONS["in_progress"]).toContain("concerns_identified");
    expect(VALID_TRANSITIONS["in_progress"]).toContain("critical_issues");
  });

  it("satisfactory has no exits", () => {
    expect(VALID_TRANSITIONS["satisfactory"]).toHaveLength(0);
  });

  it("concerns_identified has no exits", () => {
    expect(VALID_TRANSITIONS["concerns_identified"]).toHaveLength(0);
  });

  it("critical_issues has no exits", () => {
    expect(VALID_TRANSITIONS["critical_issues"]).toHaveLength(0);
  });
});

// ====================================================================
// isValidTransition
// ====================================================================

describe("isValidTransition", () => {
  it("not_started → in_progress is valid", () => {
    expect(isValidTransition("not_started", "in_progress")).toBe(true);
  });

  it("in_progress → satisfactory is valid", () => {
    expect(isValidTransition("in_progress", "satisfactory")).toBe(true);
  });

  it("in_progress → concerns_identified is valid", () => {
    expect(isValidTransition("in_progress", "concerns_identified")).toBe(true);
  });

  it("in_progress → critical_issues is valid", () => {
    expect(isValidTransition("in_progress", "critical_issues")).toBe(true);
  });

  it("not_started → satisfactory is invalid (cannot skip in_progress)", () => {
    expect(isValidTransition("not_started", "satisfactory")).toBe(false);
  });

  it("not_started → concerns_identified is invalid", () => {
    expect(isValidTransition("not_started", "concerns_identified")).toBe(false);
  });

  it("not_started → critical_issues is invalid", () => {
    expect(isValidTransition("not_started", "critical_issues")).toBe(false);
  });

  it("satisfactory → anything is invalid (terminal)", () => {
    expect(isValidTransition("satisfactory", "in_progress")).toBe(false);
    expect(isValidTransition("satisfactory", "not_started")).toBe(false);
    expect(isValidTransition("satisfactory", "critical_issues")).toBe(false);
  });

  it("concerns_identified → anything is invalid (terminal)", () => {
    expect(isValidTransition("concerns_identified", "in_progress")).toBe(false);
    expect(isValidTransition("concerns_identified", "satisfactory")).toBe(false);
  });

  it("critical_issues → anything is invalid (terminal)", () => {
    expect(isValidTransition("critical_issues", "in_progress")).toBe(false);
    expect(isValidTransition("critical_issues", "satisfactory")).toBe(false);
  });

  it("unknown from-status returns false", () => {
    expect(isValidTransition("unknown_status", "in_progress")).toBe(false);
  });

  it("unknown to-status returns false", () => {
    expect(isValidTransition("in_progress", "unknown_status")).toBe(false);
  });
});
