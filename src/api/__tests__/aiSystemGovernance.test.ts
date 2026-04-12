import { describe, it, expect } from "vitest";
import { validateAiSystemCreate } from "../lib/aiSystemValidation.js";
import { validateGovernanceReviewCreate } from "../lib/governanceReviewValidation.js";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_SYSTEM_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ================================================================
// validateAiSystemCreate
// ================================================================

// ----------------------------------------------------------------
// Body shape
// ----------------------------------------------------------------

describe("validateAiSystemCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateAiSystemCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateAiSystemCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateAiSystemCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ----------------------------------------------------------------
// name
// ----------------------------------------------------------------

describe("validateAiSystemCreate — name", () => {
  it("rejects missing name", () => {
    const r = validateAiSystemCreate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects empty name", () => {
    const r = validateAiSystemCreate({ name: "   " });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects numeric name", () => {
    const r = validateAiSystemCreate({ name: 42 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("accepts name and trims it", () => {
    const r = validateAiSystemCreate({ name: "  Fraud Detection Model  " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.name).toBe("Fraud Detection Model");
  });
});

// ----------------------------------------------------------------
// criticality
// ----------------------------------------------------------------

describe("validateAiSystemCreate — criticality", () => {
  it("accepts null criticality", () => {
    const r = validateAiSystemCreate({ name: "System A", criticality: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBeNull();
  });

  it("rejects invalid criticality", () => {
    const r = validateAiSystemCreate({ name: "System A", criticality: "extreme" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_criticality");
  });

  it("rejects uppercase criticality", () => {
    const r = validateAiSystemCreate({ name: "System A", criticality: "Critical" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_criticality");
  });

  it("accepts critical", () => {
    const r = validateAiSystemCreate({ name: "System A", criticality: "critical" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBe("critical");
  });

  it("accepts high", () => {
    const r = validateAiSystemCreate({ name: "System A", criticality: "high" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBe("high");
  });

  it("accepts medium", () => {
    const r = validateAiSystemCreate({ name: "System A", criticality: "medium" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBe("medium");
  });

  it("accepts low", () => {
    const r = validateAiSystemCreate({ name: "System A", criticality: "low" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBe("low");
  });

  it("defaults to null when not provided", () => {
    const r = validateAiSystemCreate({ name: "System A" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBeNull();
  });
});

// ----------------------------------------------------------------
// owner_user_id
// ----------------------------------------------------------------

describe("validateAiSystemCreate — owner_user_id", () => {
  it("rejects non-UUID owner_user_id", () => {
    const r = validateAiSystemCreate({ name: "System A", owner_user_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("owner_user_id_must_be_uuid");
  });

  it("accepts null owner_user_id", () => {
    const r = validateAiSystemCreate({ name: "System A", owner_user_id: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBeNull();
  });

  it("accepts valid UUID owner_user_id", () => {
    const r = validateAiSystemCreate({ name: "System A", owner_user_id: VALID_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBe(VALID_UUID);
  });

  it("defaults to null when not provided", () => {
    const r = validateAiSystemCreate({ name: "System A" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBeNull();
  });
});

// ----------------------------------------------------------------
// Unconstrained text fields (use_case, model_type, data_classification,
// deployment_status, risk_classification)
// ----------------------------------------------------------------

describe("validateAiSystemCreate — unconstrained text fields", () => {
  it("accepts use_case string and trims", () => {
    const r = validateAiSystemCreate({ name: "S", use_case: "  Fraud detection  " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.use_case).toBe("Fraud detection");
  });

  it("defaults use_case to null when absent", () => {
    const r = validateAiSystemCreate({ name: "S" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.use_case).toBeNull();
  });

  it("accepts model_type string", () => {
    const r = validateAiSystemCreate({ name: "S", model_type: "LLM" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.model_type).toBe("LLM");
  });

  it("defaults model_type to null when absent", () => {
    const r = validateAiSystemCreate({ name: "S" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.model_type).toBeNull();
  });

  it("accepts data_classification string", () => {
    const r = validateAiSystemCreate({ name: "S", data_classification: "confidential" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.data_classification).toBe("confidential");
  });

  it("defaults data_classification to null when absent", () => {
    const r = validateAiSystemCreate({ name: "S" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.data_classification).toBeNull();
  });

  it("accepts deployment_status string", () => {
    const r = validateAiSystemCreate({ name: "S", deployment_status: "production" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.deployment_status).toBe("production");
  });

  it("defaults deployment_status to null when absent", () => {
    const r = validateAiSystemCreate({ name: "S" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.deployment_status).toBeNull();
  });

  it("accepts risk_classification string", () => {
    const r = validateAiSystemCreate({ name: "S", risk_classification: "high_risk" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.risk_classification).toBe("high_risk");
  });

  it("defaults risk_classification to null when absent", () => {
    const r = validateAiSystemCreate({ name: "S" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.risk_classification).toBeNull();
  });
});

// ----------------------------------------------------------------
// Minimal and full valid bodies
// ----------------------------------------------------------------

describe("validateAiSystemCreate — minimal valid body", () => {
  it("accepts name only", () => {
    const r = validateAiSystemCreate({ name: "Fraud Model" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("Fraud Model");
      expect(r.input.use_case).toBeNull();
      expect(r.input.owner_user_id).toBeNull();
      expect(r.input.model_type).toBeNull();
      expect(r.input.data_classification).toBeNull();
      expect(r.input.deployment_status).toBeNull();
      expect(r.input.criticality).toBeNull();
      expect(r.input.risk_classification).toBeNull();
    }
  });
});

describe("validateAiSystemCreate — full valid body", () => {
  it("accepts all fields populated", () => {
    const r = validateAiSystemCreate({
      name: "Fraud Detection Model",
      use_case: "Real-time transaction fraud detection",
      owner_user_id: VALID_UUID,
      model_type: "classification",
      data_classification: "confidential",
      deployment_status: "production",
      criticality: "high",
      risk_classification: "high_risk"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("Fraud Detection Model");
      expect(r.input.use_case).toBe("Real-time transaction fraud detection");
      expect(r.input.owner_user_id).toBe(VALID_UUID);
      expect(r.input.model_type).toBe("classification");
      expect(r.input.data_classification).toBe("confidential");
      expect(r.input.deployment_status).toBe("production");
      expect(r.input.criticality).toBe("high");
      expect(r.input.risk_classification).toBe("high_risk");
    }
  });
});

// ================================================================
// validateGovernanceReviewCreate
// ================================================================

// ----------------------------------------------------------------
// Body shape
// ----------------------------------------------------------------

describe("validateGovernanceReviewCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateGovernanceReviewCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateGovernanceReviewCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateGovernanceReviewCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ----------------------------------------------------------------
// ai_system_id
// ----------------------------------------------------------------

describe("validateGovernanceReviewCreate — ai_system_id", () => {
  it("rejects missing ai_system_id", () => {
    const r = validateGovernanceReviewCreate({
      review_type: "annual",
      overall_severity: "High"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_required");
  });

  it("rejects empty ai_system_id", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: "",
      review_type: "annual",
      overall_severity: "High"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_required");
  });

  it("rejects non-UUID ai_system_id", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: "not-a-uuid",
      review_type: "annual",
      overall_severity: "High"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("ai_system_id_must_be_uuid");
  });

  it("accepts a valid UUID ai_system_id", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.ai_system_id).toBe(VALID_SYSTEM_UUID);
  });
});

// ----------------------------------------------------------------
// review_type
// ----------------------------------------------------------------

describe("validateGovernanceReviewCreate — review_type", () => {
  it("rejects missing review_type", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      overall_severity: "High"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("review_type_required");
  });

  it("rejects empty review_type", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "   ",
      overall_severity: "High"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("review_type_required");
  });

  it("accepts review_type and trims it", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "  initial risk review  ",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.review_type).toBe("initial risk review");
  });
});

// ----------------------------------------------------------------
// overall_severity
// ----------------------------------------------------------------

describe("validateGovernanceReviewCreate — overall_severity", () => {
  it("rejects missing overall_severity", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("rejects invalid overall_severity", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "Extreme"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it("rejects lowercase severity", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "high"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it("accepts Critical", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "Critical"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Critical");
  });

  it("accepts High", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("High");
  });

  it("accepts Moderate", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Moderate");
  });

  it("accepts Low", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "Low"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Low");
  });
});

// ----------------------------------------------------------------
// summary
// ----------------------------------------------------------------

describe("validateGovernanceReviewCreate — summary", () => {
  it("defaults to null when not provided", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("accepts null summary", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      summary: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("accepts a string summary and trims it", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      summary: "  Missing human oversight controls.  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBe("Missing human oversight controls.");
  });

  it("rejects non-string, non-null summary", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      summary: 42
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("summary_must_be_string_or_null");
  });
});

// ----------------------------------------------------------------
// outcome
// ----------------------------------------------------------------

describe("validateGovernanceReviewCreate — outcome", () => {
  it("defaults to null when not provided", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.outcome).toBeNull();
  });

  it("accepts null outcome", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      outcome: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.outcome).toBeNull();
  });

  it("accepts a string outcome", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      outcome: "approved_with_conditions"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.outcome).toBe("approved_with_conditions");
  });

  it("rejects non-string, non-null outcome", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      outcome: true
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("outcome_must_be_string_or_null");
  });
});

// ----------------------------------------------------------------
// performed_at
// ----------------------------------------------------------------

describe("validateGovernanceReviewCreate — performed_at", () => {
  it("defaults to null when not provided", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts null performed_at", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      performed_at: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts a valid ISO date string", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      performed_at: "2026-04-14"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-14");
  });

  it("rejects malformed date string", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      performed_at: "April 14, 2026"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_invalid_format");
  });

  it("rejects non-string performed_at", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      performed_at: 20260414
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_must_be_date_string_or_null");
  });
});

// ----------------------------------------------------------------
// reviewer_id
// ----------------------------------------------------------------

describe("validateGovernanceReviewCreate — reviewer_id", () => {
  it("defaults to null when not provided", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("accepts null reviewer_id", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      reviewer_id: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("rejects non-UUID reviewer_id", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High",
      reviewer_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });

  it("accepts a valid UUID reviewer_id", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
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

describe("validateGovernanceReviewCreate — minimal valid body", () => {
  it("accepts required fields only", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "annual",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.ai_system_id).toBe(VALID_SYSTEM_UUID);
      expect(r.input.review_type).toBe("annual");
      expect(r.input.overall_severity).toBe("High");
      expect(r.input.summary).toBeNull();
      expect(r.input.outcome).toBeNull();
      expect(r.input.performed_at).toBeNull();
      expect(r.input.reviewer_id).toBeNull();
    }
  });
});

describe("validateGovernanceReviewCreate — full valid body", () => {
  it("accepts all fields populated", () => {
    const r = validateGovernanceReviewCreate({
      ai_system_id: VALID_SYSTEM_UUID,
      review_type: "initial risk review",
      overall_severity: "Critical",
      summary: "System lacks documented oversight controls.",
      outcome: "approved_with_conditions",
      performed_at: "2026-04-14",
      reviewer_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.ai_system_id).toBe(VALID_SYSTEM_UUID);
      expect(r.input.review_type).toBe("initial risk review");
      expect(r.input.overall_severity).toBe("Critical");
      expect(r.input.summary).toBe("System lacks documented oversight controls.");
      expect(r.input.outcome).toBe("approved_with_conditions");
      expect(r.input.performed_at).toBe("2026-04-14");
      expect(r.input.reviewer_id).toBe(VALID_UUID);
    }
  });
});
