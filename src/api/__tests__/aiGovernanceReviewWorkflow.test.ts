import { describe, it, expect, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import {
  validateAiGovernanceAssessmentCreate,
  validateAiGovernanceAssessmentStatusTransition,
  FINDING_STATUSES
} from "../lib/aiGovernanceAssessmentValidation.js";
import { VALID_SOURCE_TYPES } from "../lib/evidenceValidation.js";
import { buildEvidenceSummary } from "../routes/evidence.js";

// ====================================================================
// Helpers
// ====================================================================

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function minimalCreate() {
  return { ai_system_id: VALID_UUID };
}

function validCreate(overrides: Record<string, unknown> = {}) {
  return { ...minimalCreate(), ...overrides };
}

// ====================================================================
// FINDING_STATUSES export
// ====================================================================

describe("FINDING_STATUSES", () => {
  it("includes non_compliant", () => {
    expect(FINDING_STATUSES.has("non_compliant")).toBe(true);
  });

  it("includes partially_compliant", () => {
    expect(FINDING_STATUSES.has("partially_compliant")).toBe(true);
  });

  it("does not include compliant", () => {
    expect(FINDING_STATUSES.has("compliant")).toBe(false);
  });

  it("does not include not_started", () => {
    expect(FINDING_STATUSES.has("not_started")).toBe(false);
  });

  it("does not include in_progress", () => {
    expect(FINDING_STATUSES.has("in_progress")).toBe(false);
  });
});

// ====================================================================
// validateAiGovernanceAssessmentCreate — body shape
// ====================================================================

describe("validateAiGovernanceAssessmentCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateAiGovernanceAssessmentCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateAiGovernanceAssessmentCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects non-object body", () => {
    const r = validateAiGovernanceAssessmentCreate("string");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("accepts minimal valid body", () => {
    const r = validateAiGovernanceAssessmentCreate(minimalCreate());
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateAiGovernanceAssessmentCreate — ai_system_id
// ====================================================================

describe("validateAiGovernanceAssessmentCreate — ai_system_id", () => {
  it("rejects missing ai_system_id", () => {
    const r = validateAiGovernanceAssessmentCreate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_required");
  });

  it("rejects empty ai_system_id", () => {
    const r = validateAiGovernanceAssessmentCreate({ ai_system_id: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_required");
  });

  it("rejects non-UUID ai_system_id", () => {
    const r = validateAiGovernanceAssessmentCreate({ ai_system_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_must_be_uuid");
  });

  it("accepts valid UUID ai_system_id", () => {
    const r = validateAiGovernanceAssessmentCreate(minimalCreate());
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.ai_system_id).toBe(VALID_UUID);
  });
});

// ====================================================================
// validateAiGovernanceAssessmentCreate — status
// ====================================================================

describe("validateAiGovernanceAssessmentCreate — status", () => {
  it("defaults status to 'not_started' when absent", () => {
    const r = validateAiGovernanceAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.status).toBe("not_started");
  });

  it("rejects empty status", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ status: "" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_must_be_non_empty_string");
  });

  it("rejects invalid status", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ status: "unknown" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it.each(["not_started", "in_progress", "compliant", "non_compliant", "partially_compliant"])(
    "accepts status=%s",
    (s) => {
      const r = validateAiGovernanceAssessmentCreate(validCreate({ status: s }));
      expect("input" in r).toBe(true);
    }
  );
});

// ====================================================================
// validateAiGovernanceAssessmentCreate — overall_severity (optional at POST)
// ====================================================================

describe("validateAiGovernanceAssessmentCreate — overall_severity", () => {
  it("defaults to null when absent", () => {
    const r = validateAiGovernanceAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("accepts null overall_severity", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ overall_severity: null }));
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("rejects invalid overall_severity", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ overall_severity: "Extreme" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it("rejects non-string non-null overall_severity", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ overall_severity: 42 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_must_be_string_or_null");
  });

  it.each(["Critical", "High", "Moderate", "Low"])("accepts severity=%s", (sev) => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ overall_severity: sev }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe(sev);
  });

  // overall_severity is NOT required at POST even for finding-triggering statuses
  it("does not require overall_severity when status=non_compliant at POST", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ status: "non_compliant" }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("does not require overall_severity when status=partially_compliant at POST", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ status: "partially_compliant" }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });
});

// ====================================================================
// validateAiGovernanceAssessmentCreate — optional string fields
// ====================================================================

describe("validateAiGovernanceAssessmentCreate — optional string fields", () => {
  it("defaults summary to null when absent", () => {
    const r = validateAiGovernanceAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("rejects non-string summary", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ summary: 42 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("summary_must_be_string_or_null");
  });

  it("normalizes whitespace-only summary to null", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ summary: "   " }));
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("trims and accepts valid summary", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ summary: "  Bias detected  " }));
    if ("input" in r) expect(r.input.summary).toBe("Bias detected");
  });

  it("defaults notes to null when absent", () => {
    const r = validateAiGovernanceAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts string notes", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ notes: "Reviewed inference logs" }));
    if ("input" in r) expect(r.input.notes).toBe("Reviewed inference logs");
  });
});

// ====================================================================
// validateAiGovernanceAssessmentCreate — performed_at
// ====================================================================

describe("validateAiGovernanceAssessmentCreate — performed_at", () => {
  it("defaults to null when absent", () => {
    const r = validateAiGovernanceAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts ISO date string", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ performed_at: "2026-04-13" }));
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-13");
  });

  it("rejects invalid date format", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ performed_at: "April 13 2026" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_invalid_format");
  });

  it("rejects non-string performed_at", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ performed_at: 20260413 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_must_be_date_string_or_null");
  });

  it("accepts null performed_at", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ performed_at: null }));
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });
});

// ====================================================================
// validateAiGovernanceAssessmentCreate — reviewer_id
// ====================================================================

describe("validateAiGovernanceAssessmentCreate — reviewer_id", () => {
  it("defaults to null when absent", () => {
    const r = validateAiGovernanceAssessmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("accepts valid UUID reviewer_id", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ reviewer_id: VALID_UUID }));
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });

  it("rejects non-UUID reviewer_id", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ reviewer_id: "user@example.com" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });

  it("accepts null reviewer_id", () => {
    const r = validateAiGovernanceAssessmentCreate(validCreate({ reviewer_id: null }));
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });
});

// ====================================================================
// validateAiGovernanceAssessmentStatusTransition — body shape
// ====================================================================

describe("validateAiGovernanceAssessmentStatusTransition — body shape", () => {
  it("rejects null body", () => {
    const r = validateAiGovernanceAssessmentStatusTransition(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateAiGovernanceAssessmentStatusTransition([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects missing status", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_required");
  });

  it("rejects empty status", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({ status: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_required");
  });

  it("rejects invalid status", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({ status: "blocked" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts compliant status without severity", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({ status: "compliant" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });
});

// ====================================================================
// validateAiGovernanceAssessmentStatusTransition — severity gating
// ====================================================================

describe("validateAiGovernanceAssessmentStatusTransition — severity gating", () => {
  it("requires overall_severity when status=non_compliant", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({ status: "non_compliant" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("requires overall_severity when status=partially_compliant", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({ status: "partially_compliant" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("rejects null overall_severity for finding-triggering status", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "non_compliant",
      overall_severity: null
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("rejects invalid severity on finding-triggering status", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "non_compliant",
      overall_severity: "Extreme"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it.each(["Critical", "High", "Moderate", "Low"])(
    "accepts severity=%s on non_compliant transition",
    (sev) => {
      const r = validateAiGovernanceAssessmentStatusTransition({
        status: "non_compliant",
        overall_severity: sev
      });
      expect("input" in r).toBe(true);
      if ("input" in r) expect(r.input.overall_severity).toBe(sev);
    }
  );

  it("accepts severity on partially_compliant transition", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "partially_compliant",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("partially_compliant");
      expect(r.input.overall_severity).toBe("High");
    }
  });

  it("allows optional severity on non-finding-triggering statuses", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "in_progress",
      overall_severity: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Moderate");
  });

  it("allows absent severity on not_started", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({ status: "not_started" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("rejects invalid severity on non-finding-triggering status", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "in_progress",
      overall_severity: "Extreme"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });
});

// ====================================================================
// validateAiGovernanceAssessmentStatusTransition — optional fields
// ====================================================================

describe("validateAiGovernanceAssessmentStatusTransition — optional fields", () => {
  it("passes summary through", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "non_compliant",
      overall_severity: "High",
      summary: "Model shows bias against protected class"
    });
    if ("input" in r) expect(r.input.summary).toBe("Model shows bias against protected class");
  });

  it("normalizes whitespace-only summary to null", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "compliant",
      summary: "   "
    });
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("rejects non-string notes", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "compliant",
      notes: 123
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_must_be_string_or_null");
  });

  it("accepts string notes", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "compliant",
      notes: "All governance controls verified"
    });
    if ("input" in r) expect(r.input.notes).toBe("All governance controls verified");
  });

  it("accepts performed_at ISO date", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "compliant",
      performed_at: "2026-04-13"
    });
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-13");
  });

  it("rejects invalid performed_at format", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "compliant",
      performed_at: "13/04/2026"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_invalid_format");
  });

  it("accepts reviewer_id UUID", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "compliant",
      reviewer_id: VALID_UUID
    });
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });

  it("rejects non-UUID reviewer_id", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "compliant",
      reviewer_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });

  it("accepts null reviewer_id", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({
      status: "compliant",
      reviewer_id: null
    });
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("defaults all optional fields to null when absent", () => {
    const r = validateAiGovernanceAssessmentStatusTransition({ status: "in_progress" });
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
// Evidence integration — VALID_SOURCE_TYPES includes ai_governance_review
// ====================================================================

describe("VALID_SOURCE_TYPES — ai_governance_review", () => {
  it("includes ai_governance_review", () => {
    expect(VALID_SOURCE_TYPES.has("ai_governance_review")).toBe(true);
  });

  it("still includes ai_review", () => {
    expect(VALID_SOURCE_TYPES.has("ai_review")).toBe(true);
  });
});

// ====================================================================
// buildEvidenceSummary — ai_governance_review key
// ====================================================================

describe("buildEvidenceSummary — ai_governance_review", () => {
  it("includes ai_governance_review key defaulting to 0", () => {
    const result = buildEvidenceSummary([]);
    expect(result.by_source_type).toHaveProperty("ai_governance_review", 0);
  });

  it("counts ai_governance_review rows correctly", () => {
    const result = buildEvidenceSummary([
      { source_type: "ai_governance_review", count: "3" }
    ]);
    expect(result.by_source_type.ai_governance_review).toBe(3);
    expect(result.total).toBe(3);
  });

  it("includes ai_governance_review in total alongside other types", () => {
    const result = buildEvidenceSummary([
      { source_type: "ai_governance_review", count: "2" },
      { source_type: "ai_review", count: "1" }
    ]);
    expect(result.by_source_type.ai_governance_review).toBe(2);
    expect(result.by_source_type.ai_review).toBe(1);
    expect(result.total).toBe(3);
  });
});
