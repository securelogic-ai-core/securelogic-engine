import { describe, it, expect } from "vitest";
import {
  validateControlAssessmentCreate,
  validateControlAssessmentStatusTransition
} from "../lib/controlAssessmentValidation.js";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_CONTROL_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ====================================================================
// validateControlAssessmentCreate
// ====================================================================

// ----------------------------------------------------------------
// Body shape
// ----------------------------------------------------------------

describe("validateControlAssessmentCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateControlAssessmentCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateControlAssessmentCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateControlAssessmentCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ----------------------------------------------------------------
// control_id
// ----------------------------------------------------------------

describe("validateControlAssessmentCreate — control_id", () => {
  it("rejects missing control_id", () => {
    const r = validateControlAssessmentCreate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_required");
  });

  it("rejects empty control_id", () => {
    const r = validateControlAssessmentCreate({ control_id: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_required");
  });

  it("rejects non-UUID control_id", () => {
    const r = validateControlAssessmentCreate({ control_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_must_be_uuid");
  });

  it("accepts a valid UUID control_id", () => {
    const r = validateControlAssessmentCreate({ control_id: VALID_CONTROL_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.control_id).toBe(VALID_CONTROL_UUID);
  });
});

// ----------------------------------------------------------------
// status (at create time)
// ----------------------------------------------------------------

describe("validateControlAssessmentCreate — status", () => {
  it("defaults to not_started when omitted", () => {
    const r = validateControlAssessmentCreate({ control_id: VALID_CONTROL_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("not_started");
  });

  it("rejects invalid status", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      status: "approved"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts not_started", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      status: "not_started"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("not_started");
  });

  it("accepts in_progress", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      status: "in_progress"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("in_progress");
  });

  it("accepts passed", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      status: "passed"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("passed");
  });

  it("accepts failed", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      status: "failed"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("failed");
  });

  it("accepts remediation_required", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      status: "remediation_required"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("remediation_required");
  });
});

// ----------------------------------------------------------------
// overall_severity (nullable at create)
// ----------------------------------------------------------------

describe("validateControlAssessmentCreate — overall_severity", () => {
  it("defaults to null when omitted", () => {
    const r = validateControlAssessmentCreate({ control_id: VALID_CONTROL_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("accepts null overall_severity", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      overall_severity: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("rejects invalid overall_severity", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      overall_severity: "Severe"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it("accepts Critical", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      overall_severity: "Critical"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Critical");
  });

  it("accepts High", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("High");
  });

  it("accepts Moderate", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      overall_severity: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Moderate");
  });

  it("accepts Low", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      overall_severity: "Low"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Low");
  });
});

// ----------------------------------------------------------------
// summary
// ----------------------------------------------------------------

describe("validateControlAssessmentCreate — summary", () => {
  it("defaults to null when not provided", () => {
    const r = validateControlAssessmentCreate({ control_id: VALID_CONTROL_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("accepts null summary", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      summary: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("trims and accepts a string summary", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      summary: "  Access control reviewed.  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBe("Access control reviewed.");
  });

  it("rejects non-string, non-null summary", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      summary: 42
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("summary_must_be_string_or_null");
  });
});

// ----------------------------------------------------------------
// notes
// ----------------------------------------------------------------

describe("validateControlAssessmentCreate — notes", () => {
  it("defaults to null when not provided", () => {
    const r = validateControlAssessmentCreate({ control_id: VALID_CONTROL_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts null notes", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      notes: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts a string notes value", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      notes: "Evidence collected from system audit."
    });
    expect("input" in r).toBe(true);
    if ("input" in r)
      expect(r.input.notes).toBe("Evidence collected from system audit.");
  });

  it("rejects non-string, non-null notes", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      notes: true
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_must_be_string_or_null");
  });
});

// ----------------------------------------------------------------
// performed_at
// ----------------------------------------------------------------

describe("validateControlAssessmentCreate — performed_at", () => {
  it("defaults to null when not provided", () => {
    const r = validateControlAssessmentCreate({ control_id: VALID_CONTROL_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts null performed_at", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      performed_at: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts a valid ISO date string", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      performed_at: "2026-04-12"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-12");
  });

  it("rejects malformed date string", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      performed_at: "April 12, 2026"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_invalid_format");
  });

  it("rejects non-string performed_at", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      performed_at: 20260412
    });
    expect("error" in r).toBe(true);
    if ("error" in r)
      expect(r.error).toBe("performed_at_must_be_date_string_or_null");
  });
});

// ----------------------------------------------------------------
// reviewer_id
// ----------------------------------------------------------------

describe("validateControlAssessmentCreate — reviewer_id", () => {
  it("defaults to null when not provided", () => {
    const r = validateControlAssessmentCreate({ control_id: VALID_CONTROL_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("accepts null reviewer_id", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      reviewer_id: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("rejects non-UUID reviewer_id", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      reviewer_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });

  it("accepts a valid UUID reviewer_id", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      reviewer_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });
});

// ----------------------------------------------------------------
// Minimal and full valid bodies
// ----------------------------------------------------------------

describe("validateControlAssessmentCreate — minimal valid body", () => {
  it("accepts control_id only", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.control_id).toBe(VALID_CONTROL_UUID);
      expect(r.input.status).toBe("not_started");
      expect(r.input.overall_severity).toBeNull();
      expect(r.input.summary).toBeNull();
      expect(r.input.notes).toBeNull();
      expect(r.input.performed_at).toBeNull();
      expect(r.input.reviewer_id).toBeNull();
    }
  });
});

describe("validateControlAssessmentCreate — full valid body", () => {
  it("accepts all fields populated", () => {
    const r = validateControlAssessmentCreate({
      control_id: VALID_CONTROL_UUID,
      status: "in_progress",
      overall_severity: "High",
      summary: "Initial review in progress.",
      notes: "Pending evidence collection.",
      performed_at: "2026-04-10",
      reviewer_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.control_id).toBe(VALID_CONTROL_UUID);
      expect(r.input.status).toBe("in_progress");
      expect(r.input.overall_severity).toBe("High");
      expect(r.input.summary).toBe("Initial review in progress.");
      expect(r.input.notes).toBe("Pending evidence collection.");
      expect(r.input.performed_at).toBe("2026-04-10");
      expect(r.input.reviewer_id).toBe(VALID_UUID);
    }
  });
});

// ====================================================================
// validateControlAssessmentStatusTransition
// ====================================================================

// ----------------------------------------------------------------
// Body shape
// ----------------------------------------------------------------

describe("validateControlAssessmentStatusTransition — body shape", () => {
  it("rejects null body", () => {
    const r = validateControlAssessmentStatusTransition(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateControlAssessmentStatusTransition([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ----------------------------------------------------------------
// status
// ----------------------------------------------------------------

describe("validateControlAssessmentStatusTransition — status", () => {
  it("rejects missing status", () => {
    const r = validateControlAssessmentStatusTransition({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_required");
  });

  it("rejects empty status", () => {
    const r = validateControlAssessmentStatusTransition({ status: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_required");
  });

  it("rejects invalid status", () => {
    const r = validateControlAssessmentStatusTransition({ status: "completed" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts not_started", () => {
    const r = validateControlAssessmentStatusTransition({ status: "not_started" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("not_started");
  });

  it("accepts in_progress", () => {
    const r = validateControlAssessmentStatusTransition({ status: "in_progress" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("in_progress");
  });

  it("accepts passed", () => {
    const r = validateControlAssessmentStatusTransition({ status: "passed" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("passed");
      expect(r.input.overall_severity).toBeNull();
    }
  });
});

// ----------------------------------------------------------------
// overall_severity required for finding-triggering statuses
// ----------------------------------------------------------------

describe("validateControlAssessmentStatusTransition — overall_severity required for failed/remediation_required", () => {
  it("rejects failed without overall_severity", () => {
    const r = validateControlAssessmentStatusTransition({ status: "failed" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("rejects remediation_required without overall_severity", () => {
    const r = validateControlAssessmentStatusTransition({
      status: "remediation_required"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("rejects failed with invalid overall_severity", () => {
    const r = validateControlAssessmentStatusTransition({
      status: "failed",
      overall_severity: "Extreme"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it("accepts failed with Critical", () => {
    const r = validateControlAssessmentStatusTransition({
      status: "failed",
      overall_severity: "Critical"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("failed");
      expect(r.input.overall_severity).toBe("Critical");
    }
  });

  it("accepts failed with High", () => {
    const r = validateControlAssessmentStatusTransition({
      status: "failed",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("failed");
      expect(r.input.overall_severity).toBe("High");
    }
  });

  it("accepts failed with Moderate", () => {
    const r = validateControlAssessmentStatusTransition({
      status: "failed",
      overall_severity: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("failed");
      expect(r.input.overall_severity).toBe("Moderate");
    }
  });

  it("accepts failed with Low", () => {
    const r = validateControlAssessmentStatusTransition({
      status: "failed",
      overall_severity: "Low"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("failed");
      expect(r.input.overall_severity).toBe("Low");
    }
  });

  it("accepts remediation_required with High", () => {
    const r = validateControlAssessmentStatusTransition({
      status: "remediation_required",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("remediation_required");
      expect(r.input.overall_severity).toBe("High");
    }
  });
});

// ----------------------------------------------------------------
// overall_severity optional for non-finding-triggering statuses
// ----------------------------------------------------------------

describe("validateControlAssessmentStatusTransition — overall_severity optional for other statuses", () => {
  it("accepts passed with no overall_severity — null returned", () => {
    const r = validateControlAssessmentStatusTransition({ status: "passed" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("accepts in_progress with an optional overall_severity", () => {
    const r = validateControlAssessmentStatusTransition({
      status: "in_progress",
      overall_severity: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("in_progress");
      expect(r.input.overall_severity).toBe("Moderate");
    }
  });

  it("accepts not_started with no overall_severity", () => {
    const r = validateControlAssessmentStatusTransition({ status: "not_started" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });
});
