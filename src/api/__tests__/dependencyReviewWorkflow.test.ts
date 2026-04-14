import { describe, it, expect } from "vitest";
import {
  validateDependencyAssessmentCreate,
  validateDependencyAssessmentStatusTransition,
  FINDING_STATUSES
} from "../lib/dependencyReviewValidation.js";

// ====================================================================
// Helpers
// ====================================================================

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function minimalCreate() {
  return { dependency_id: VALID_UUID };
}

function validCreate(overrides: Record<string, unknown> = {}) {
  return { ...minimalCreate(), ...overrides };
}

// ====================================================================
// FINDING_STATUSES export
// ====================================================================

describe("FINDING_STATUSES", () => {
  it("includes flagged", () => {
    expect(FINDING_STATUSES.has("flagged")).toBe(true);
  });

  it("includes needs_remediation", () => {
    expect(FINDING_STATUSES.has("needs_remediation")).toBe(true);
  });

  it("does not include acceptable", () => {
    expect(FINDING_STATUSES.has("acceptable")).toBe(false);
  });

  it("does not include not_started", () => {
    expect(FINDING_STATUSES.has("not_started")).toBe(false);
  });
});

// ====================================================================
// validateDependencyAssessmentCreate — body shape
// ====================================================================

describe("validateDependencyAssessmentCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateDependencyAssessmentCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateDependencyAssessmentCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("accepts minimal valid body", () => {
    const r = validateDependencyAssessmentCreate(minimalCreate());
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateDependencyAssessmentCreate — dependency_id
// ====================================================================

describe("validateDependencyAssessmentCreate — dependency_id", () => {
  it("rejects missing dependency_id", () => {
    const r = validateDependencyAssessmentCreate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("dependency_id_required");
  });

  it("rejects empty dependency_id", () => {
    const r = validateDependencyAssessmentCreate({ dependency_id: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("dependency_id_required");
  });

  it("rejects non-UUID dependency_id", () => {
    const r = validateDependencyAssessmentCreate({ dependency_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("dependency_id_must_be_uuid");
  });

  it("accepts valid UUID dependency_id", () => {
    const r = validateDependencyAssessmentCreate(minimalCreate());
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.dependency_id).toBe(VALID_UUID);
  });
});

// ====================================================================
// validateDependencyAssessmentCreate — status
// ====================================================================

describe("validateDependencyAssessmentCreate — status", () => {
  it("defaults status to 'not_started' when absent", () => {
    const r = validateDependencyAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.status).toBe("not_started");
  });

  it("rejects invalid status", () => {
    const r = validateDependencyAssessmentCreate(validCreate({ status: "unknown" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it.each(["not_started", "in_progress", "acceptable", "flagged", "needs_remediation"])(
    "accepts status=%s",
    (s) => {
      const r = validateDependencyAssessmentCreate(validCreate({ status: s }));
      expect("input" in r).toBe(true);
    }
  );
});

// ====================================================================
// validateDependencyAssessmentCreate — overall_severity
// ====================================================================

describe("validateDependencyAssessmentCreate — overall_severity", () => {
  it("defaults to null when absent", () => {
    const r = validateDependencyAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("accepts null overall_severity", () => {
    const r = validateDependencyAssessmentCreate(validCreate({ overall_severity: null }));
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("rejects invalid overall_severity", () => {
    const r = validateDependencyAssessmentCreate(validCreate({ overall_severity: "Extreme" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it.each(["Critical", "High", "Moderate", "Low"])("accepts severity=%s", (sev) => {
    const r = validateDependencyAssessmentCreate(validCreate({ overall_severity: sev }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateDependencyAssessmentCreate — optional string fields
// ====================================================================

describe("validateDependencyAssessmentCreate — optional string fields", () => {
  it("defaults summary to null when absent", () => {
    const r = validateDependencyAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("rejects non-string summary", () => {
    const r = validateDependencyAssessmentCreate(validCreate({ summary: 42 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("summary_must_be_string_or_null");
  });

  it("normalizes whitespace-only summary to null", () => {
    const r = validateDependencyAssessmentCreate(validCreate({ summary: "   " }));
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("defaults notes to null when absent", () => {
    const r = validateDependencyAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts string notes", () => {
    const r = validateDependencyAssessmentCreate(validCreate({ notes: "Library is EOL" }));
    if ("input" in r) expect(r.input.notes).toBe("Library is EOL");
  });
});

// ====================================================================
// validateDependencyAssessmentCreate — performed_at
// ====================================================================

describe("validateDependencyAssessmentCreate — performed_at", () => {
  it("defaults to null when absent", () => {
    const r = validateDependencyAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts ISO date", () => {
    const r = validateDependencyAssessmentCreate(validCreate({ performed_at: "2026-04-13" }));
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-13");
  });

  it("rejects invalid date format", () => {
    const r = validateDependencyAssessmentCreate(validCreate({ performed_at: "April 13" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_invalid_format");
  });

  it("rejects non-string performed_at", () => {
    const r = validateDependencyAssessmentCreate(validCreate({ performed_at: 20260413 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_must_be_date_string_or_null");
  });
});

// ====================================================================
// validateDependencyAssessmentCreate — reviewer_id
// ====================================================================

describe("validateDependencyAssessmentCreate — reviewer_id", () => {
  it("defaults to null when absent", () => {
    const r = validateDependencyAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("accepts valid UUID reviewer_id", () => {
    const r = validateDependencyAssessmentCreate(validCreate({ reviewer_id: VALID_UUID }));
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });

  it("rejects non-UUID reviewer_id", () => {
    const r = validateDependencyAssessmentCreate(validCreate({ reviewer_id: "user@example.com" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });
});

// ====================================================================
// validateDependencyAssessmentStatusTransition — body shape
// ====================================================================

describe("validateDependencyAssessmentStatusTransition — body shape", () => {
  it("rejects null body", () => {
    const r = validateDependencyAssessmentStatusTransition(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects missing status", () => {
    const r = validateDependencyAssessmentStatusTransition({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_required");
  });

  it("rejects invalid status", () => {
    const r = validateDependencyAssessmentStatusTransition({ status: "blocked" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts acceptable status without severity", () => {
    const r = validateDependencyAssessmentStatusTransition({ status: "acceptable" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });
});

// ====================================================================
// validateDependencyAssessmentStatusTransition — severity gating
// ====================================================================

describe("validateDependencyAssessmentStatusTransition — severity gating", () => {
  it("requires overall_severity when status=flagged", () => {
    const r = validateDependencyAssessmentStatusTransition({ status: "flagged" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("requires overall_severity when status=needs_remediation", () => {
    const r = validateDependencyAssessmentStatusTransition({ status: "needs_remediation" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("rejects invalid severity on finding-triggering status", () => {
    const r = validateDependencyAssessmentStatusTransition({
      status: "flagged",
      overall_severity: "Extreme"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it.each(["Critical", "High", "Moderate", "Low"])(
    "accepts severity=%s on flagged transition",
    (sev) => {
      const r = validateDependencyAssessmentStatusTransition({
        status: "flagged",
        overall_severity: sev
      });
      expect("input" in r).toBe(true);
      if ("input" in r) expect(r.input.overall_severity).toBe(sev);
    }
  );

  it("accepts severity on needs_remediation transition", () => {
    const r = validateDependencyAssessmentStatusTransition({
      status: "needs_remediation",
      overall_severity: "Critical"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("needs_remediation");
      expect(r.input.overall_severity).toBe("Critical");
    }
  });

  it("allows optional severity on non-finding-triggering statuses", () => {
    const r = validateDependencyAssessmentStatusTransition({
      status: "in_progress",
      overall_severity: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Moderate");
  });

  it("allows absent severity on not_started", () => {
    const r = validateDependencyAssessmentStatusTransition({ status: "not_started" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });
});

// ====================================================================
// validateDependencyAssessmentStatusTransition — optional fields
// ====================================================================

describe("validateDependencyAssessmentStatusTransition — optional fields", () => {
  it("passes summary through", () => {
    const r = validateDependencyAssessmentStatusTransition({
      status: "flagged",
      overall_severity: "High",
      summary: "Library has known CVE"
    });
    if ("input" in r) expect(r.input.summary).toBe("Library has known CVE");
  });

  it("rejects non-string notes", () => {
    const r = validateDependencyAssessmentStatusTransition({
      status: "acceptable",
      notes: 123
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_must_be_string_or_null");
  });

  it("accepts performed_at ISO date", () => {
    const r = validateDependencyAssessmentStatusTransition({
      status: "acceptable",
      performed_at: "2026-04-13"
    });
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-13");
  });

  it("accepts reviewer_id UUID", () => {
    const r = validateDependencyAssessmentStatusTransition({
      status: "acceptable",
      reviewer_id: VALID_UUID
    });
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });
});
