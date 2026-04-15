import { describe, it, expect } from "vitest";
import {
  validateObligationAssessmentCreate,
  validateObligationAssessmentStatusTransition,
  TERMINAL_STATUSES,
  FINDING_STATUSES,
  VALID_TRANSITIONS,
  isValidTransition
} from "../lib/obligationAssessmentValidation.js";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_OBLIGATION_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ====================================================================
// validateObligationAssessmentCreate
// ====================================================================

// ----------------------------------------------------------------
// Body shape
// ----------------------------------------------------------------

describe("validateObligationAssessmentCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateObligationAssessmentCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateObligationAssessmentCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateObligationAssessmentCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ----------------------------------------------------------------
// obligation_id
// ----------------------------------------------------------------

describe("validateObligationAssessmentCreate — obligation_id", () => {
  it("rejects missing obligation_id", () => {
    const r = validateObligationAssessmentCreate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_required");
  });

  it("rejects empty obligation_id", () => {
    const r = validateObligationAssessmentCreate({ obligation_id: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_required");
  });

  it("rejects non-UUID obligation_id", () => {
    const r = validateObligationAssessmentCreate({ obligation_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_must_be_uuid");
  });

  it("accepts a valid UUID obligation_id", () => {
    const r = validateObligationAssessmentCreate({ obligation_id: VALID_OBLIGATION_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.obligation_id).toBe(VALID_OBLIGATION_UUID);
  });
});

// ----------------------------------------------------------------
// status (at create time)
// ----------------------------------------------------------------

describe("validateObligationAssessmentCreate — status", () => {
  it("defaults to not_started when omitted", () => {
    const r = validateObligationAssessmentCreate({ obligation_id: VALID_OBLIGATION_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("not_started");
  });

  it("rejects invalid status", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      status: "passed"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts not_started", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      status: "not_started"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("not_started");
  });

  it("accepts in_progress", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      status: "in_progress"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("in_progress");
  });

  it("accepts compliant", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      status: "compliant"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("compliant");
  });

  it("accepts non_compliant", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      status: "non_compliant"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("non_compliant");
  });

  it("accepts partially_compliant", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      status: "partially_compliant"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("partially_compliant");
  });
});

// ----------------------------------------------------------------
// overall_severity (nullable at create)
// ----------------------------------------------------------------

describe("validateObligationAssessmentCreate — overall_severity", () => {
  it("defaults to null when omitted", () => {
    const r = validateObligationAssessmentCreate({ obligation_id: VALID_OBLIGATION_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("accepts null overall_severity", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      overall_severity: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("rejects invalid overall_severity", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      overall_severity: "Severe"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it("accepts Critical", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      overall_severity: "Critical"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Critical");
  });

  it("accepts High", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("High");
  });

  it("accepts Moderate", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      overall_severity: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Moderate");
  });

  it("accepts Low", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      overall_severity: "Low"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBe("Low");
  });
});

// ----------------------------------------------------------------
// summary
// ----------------------------------------------------------------

describe("validateObligationAssessmentCreate — summary", () => {
  it("defaults to null when not provided", () => {
    const r = validateObligationAssessmentCreate({ obligation_id: VALID_OBLIGATION_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("accepts null summary", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      summary: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("trims and accepts a string summary", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      summary: "  Obligation gap identified.  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.summary).toBe("Obligation gap identified.");
  });

  it("rejects non-string, non-null summary", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      summary: 42
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("summary_must_be_string_or_null");
  });
});

// ----------------------------------------------------------------
// notes
// ----------------------------------------------------------------

describe("validateObligationAssessmentCreate — notes", () => {
  it("defaults to null when not provided", () => {
    const r = validateObligationAssessmentCreate({ obligation_id: VALID_OBLIGATION_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts null notes", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      notes: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts a string notes value", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      notes: "Reviewed HIPAA clause 164.312."
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBe("Reviewed HIPAA clause 164.312.");
  });

  it("rejects non-string, non-null notes", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      notes: true
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_must_be_string_or_null");
  });
});

// ----------------------------------------------------------------
// performed_at
// ----------------------------------------------------------------

describe("validateObligationAssessmentCreate — performed_at", () => {
  it("defaults to null when not provided", () => {
    const r = validateObligationAssessmentCreate({ obligation_id: VALID_OBLIGATION_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts null performed_at", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      performed_at: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts a valid ISO date string", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      performed_at: "2026-04-19"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-19");
  });

  it("rejects malformed date string", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      performed_at: "April 19, 2026"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_invalid_format");
  });

  it("rejects non-string performed_at", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      performed_at: 20260419
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_must_be_date_string_or_null");
  });
});

// ----------------------------------------------------------------
// reviewer_id
// ----------------------------------------------------------------

describe("validateObligationAssessmentCreate — reviewer_id", () => {
  it("defaults to null when not provided", () => {
    const r = validateObligationAssessmentCreate({ obligation_id: VALID_OBLIGATION_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("accepts null reviewer_id", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      reviewer_id: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("rejects non-UUID reviewer_id", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      reviewer_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });

  it("accepts a valid UUID reviewer_id", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      reviewer_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });
});

// ----------------------------------------------------------------
// Minimal and full valid bodies
// ----------------------------------------------------------------

describe("validateObligationAssessmentCreate — minimal valid body", () => {
  it("accepts obligation_id only", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.obligation_id).toBe(VALID_OBLIGATION_UUID);
      expect(r.input.status).toBe("not_started");
      expect(r.input.overall_severity).toBeNull();
      expect(r.input.summary).toBeNull();
      expect(r.input.notes).toBeNull();
      expect(r.input.performed_at).toBeNull();
      expect(r.input.reviewer_id).toBeNull();
    }
  });
});

describe("validateObligationAssessmentCreate — full valid body", () => {
  it("accepts all fields populated", () => {
    const r = validateObligationAssessmentCreate({
      obligation_id: VALID_OBLIGATION_UUID,
      status: "in_progress",
      overall_severity: "High",
      summary: "Reviewing HIPAA encryption requirements.",
      notes: "Pending evidence from IT.",
      performed_at: "2026-04-19",
      reviewer_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.obligation_id).toBe(VALID_OBLIGATION_UUID);
      expect(r.input.status).toBe("in_progress");
      expect(r.input.overall_severity).toBe("High");
      expect(r.input.summary).toBe("Reviewing HIPAA encryption requirements.");
      expect(r.input.notes).toBe("Pending evidence from IT.");
      expect(r.input.performed_at).toBe("2026-04-19");
      expect(r.input.reviewer_id).toBe(VALID_UUID);
    }
  });
});

// ====================================================================
// validateObligationAssessmentStatusTransition
// ====================================================================

// ----------------------------------------------------------------
// Body shape
// ----------------------------------------------------------------

describe("validateObligationAssessmentStatusTransition — body shape", () => {
  it("rejects null body", () => {
    const r = validateObligationAssessmentStatusTransition(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateObligationAssessmentStatusTransition([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ----------------------------------------------------------------
// status
// ----------------------------------------------------------------

describe("validateObligationAssessmentStatusTransition — status", () => {
  it("rejects missing status", () => {
    const r = validateObligationAssessmentStatusTransition({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_required");
  });

  it("rejects empty status", () => {
    const r = validateObligationAssessmentStatusTransition({ status: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_required");
  });

  it("rejects invalid status", () => {
    const r = validateObligationAssessmentStatusTransition({ status: "failed" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts not_started", () => {
    const r = validateObligationAssessmentStatusTransition({ status: "not_started" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("not_started");
  });

  it("accepts in_progress", () => {
    const r = validateObligationAssessmentStatusTransition({ status: "in_progress" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("in_progress");
  });

  it("accepts compliant — no overall_severity required, no finding", () => {
    const r = validateObligationAssessmentStatusTransition({ status: "compliant" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("compliant");
      expect(r.input.overall_severity).toBeNull();
    }
  });
});

// ----------------------------------------------------------------
// overall_severity required for finding-triggering statuses
// ----------------------------------------------------------------

describe("validateObligationAssessmentStatusTransition — overall_severity required for non_compliant/partially_compliant", () => {
  it("rejects non_compliant without overall_severity", () => {
    const r = validateObligationAssessmentStatusTransition({ status: "non_compliant" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("rejects partially_compliant without overall_severity", () => {
    const r = validateObligationAssessmentStatusTransition({ status: "partially_compliant" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("overall_severity_required");
  });

  it("rejects non_compliant with invalid overall_severity", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "non_compliant",
      overall_severity: "Extreme"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_overall_severity");
  });

  it("accepts non_compliant with Critical", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "non_compliant",
      overall_severity: "Critical"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("non_compliant");
      expect(r.input.overall_severity).toBe("Critical");
    }
  });

  it("accepts non_compliant with High", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "non_compliant",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("non_compliant");
      expect(r.input.overall_severity).toBe("High");
    }
  });

  it("accepts non_compliant with Moderate", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "non_compliant",
      overall_severity: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("non_compliant");
      expect(r.input.overall_severity).toBe("Moderate");
    }
  });

  it("accepts non_compliant with Low", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "non_compliant",
      overall_severity: "Low"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("non_compliant");
      expect(r.input.overall_severity).toBe("Low");
    }
  });

  it("accepts partially_compliant with High", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "partially_compliant",
      overall_severity: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("partially_compliant");
      expect(r.input.overall_severity).toBe("High");
    }
  });

  it("accepts partially_compliant with Moderate", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "partially_compliant",
      overall_severity: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("partially_compliant");
      expect(r.input.overall_severity).toBe("Moderate");
    }
  });
});

// ----------------------------------------------------------------
// overall_severity optional for non-finding-triggering statuses
// ----------------------------------------------------------------

describe("validateObligationAssessmentStatusTransition — overall_severity optional for other statuses", () => {
  it("accepts compliant with no overall_severity — null returned", () => {
    const r = validateObligationAssessmentStatusTransition({ status: "compliant" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });

  it("accepts in_progress with optional overall_severity", () => {
    const r = validateObligationAssessmentStatusTransition({
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
    const r = validateObligationAssessmentStatusTransition({ status: "not_started" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.overall_severity).toBeNull();
  });
});

// ----------------------------------------------------------------
// Mutable fields in PATCH body
// ----------------------------------------------------------------

describe("validateObligationAssessmentStatusTransition — mutable fields", () => {
  it("accepts summary update alongside status", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "in_progress",
      summary: "Gap analysis ongoing."
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("in_progress");
      expect(r.input.summary).toBe("Gap analysis ongoing.");
    }
  });

  it("accepts notes update alongside status", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "in_progress",
      notes: "Pending legal review."
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBe("Pending legal review.");
  });

  it("accepts performed_at update alongside status", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "compliant",
      performed_at: "2026-04-19"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-19");
  });

  it("rejects invalid performed_at in PATCH", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "in_progress",
      performed_at: "not-a-date"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_invalid_format");
  });

  it("accepts reviewer_id update alongside status", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "compliant",
      reviewer_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });

  it("rejects invalid reviewer_id in PATCH", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "in_progress",
      reviewer_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });

  it("accepts full PATCH payload: non_compliant + severity + all optional fields", () => {
    const r = validateObligationAssessmentStatusTransition({
      status: "non_compliant",
      overall_severity: "Critical",
      summary: "Encryption requirement not met.",
      notes: "Escalated to CISO.",
      performed_at: "2026-04-19",
      reviewer_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("non_compliant");
      expect(r.input.overall_severity).toBe("Critical");
      expect(r.input.summary).toBe("Encryption requirement not met.");
      expect(r.input.notes).toBe("Escalated to CISO.");
      expect(r.input.performed_at).toBe("2026-04-19");
      expect(r.input.reviewer_id).toBe(VALID_UUID);
    }
  });
});

// ----------------------------------------------------------------
// FINDING_STATUSES export
// ----------------------------------------------------------------

describe("FINDING_STATUSES export", () => {
  it("contains non_compliant", () => {
    expect(FINDING_STATUSES.has("non_compliant")).toBe(true);
  });

  it("contains partially_compliant", () => {
    expect(FINDING_STATUSES.has("partially_compliant")).toBe(true);
  });

  it("does not contain compliant", () => {
    expect(FINDING_STATUSES.has("compliant")).toBe(false);
  });

  it("does not contain not_started", () => {
    expect(FINDING_STATUSES.has("not_started")).toBe(false);
  });

  it("does not contain in_progress", () => {
    expect(FINDING_STATUSES.has("in_progress")).toBe(false);
  });
});

// ====================================================================
// TERMINAL_STATUSES export
// ====================================================================

describe("TERMINAL_STATUSES", () => {
  it("includes compliant", () => {
    expect(TERMINAL_STATUSES.has("compliant")).toBe(true);
  });

  it("includes non_compliant", () => {
    expect(TERMINAL_STATUSES.has("non_compliant")).toBe(true);
  });

  it("includes partially_compliant", () => {
    expect(TERMINAL_STATUSES.has("partially_compliant")).toBe(true);
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
    expect(VALID_TRANSITIONS["in_progress"]).toContain("compliant");
    expect(VALID_TRANSITIONS["in_progress"]).toContain("non_compliant");
    expect(VALID_TRANSITIONS["in_progress"]).toContain("partially_compliant");
  });

  it("compliant has no exits", () => {
    expect(VALID_TRANSITIONS["compliant"]).toHaveLength(0);
  });

  it("non_compliant has no exits", () => {
    expect(VALID_TRANSITIONS["non_compliant"]).toHaveLength(0);
  });

  it("partially_compliant has no exits", () => {
    expect(VALID_TRANSITIONS["partially_compliant"]).toHaveLength(0);
  });
});

// ====================================================================
// isValidTransition
// ====================================================================

describe("isValidTransition", () => {
  it("not_started → in_progress is valid", () => {
    expect(isValidTransition("not_started", "in_progress")).toBe(true);
  });

  it("in_progress → compliant is valid", () => {
    expect(isValidTransition("in_progress", "compliant")).toBe(true);
  });

  it("in_progress → non_compliant is valid", () => {
    expect(isValidTransition("in_progress", "non_compliant")).toBe(true);
  });

  it("in_progress → partially_compliant is valid", () => {
    expect(isValidTransition("in_progress", "partially_compliant")).toBe(true);
  });

  it("not_started → compliant is invalid (cannot skip in_progress)", () => {
    expect(isValidTransition("not_started", "compliant")).toBe(false);
  });

  it("not_started → non_compliant is invalid", () => {
    expect(isValidTransition("not_started", "non_compliant")).toBe(false);
  });

  it("not_started → partially_compliant is invalid", () => {
    expect(isValidTransition("not_started", "partially_compliant")).toBe(false);
  });

  it("compliant → anything is invalid (terminal)", () => {
    expect(isValidTransition("compliant", "in_progress")).toBe(false);
    expect(isValidTransition("compliant", "not_started")).toBe(false);
    expect(isValidTransition("compliant", "non_compliant")).toBe(false);
  });

  it("non_compliant → anything is invalid (terminal)", () => {
    expect(isValidTransition("non_compliant", "in_progress")).toBe(false);
    expect(isValidTransition("non_compliant", "compliant")).toBe(false);
  });

  it("partially_compliant → anything is invalid (terminal)", () => {
    expect(isValidTransition("partially_compliant", "in_progress")).toBe(false);
    expect(isValidTransition("partially_compliant", "compliant")).toBe(false);
  });

  it("unknown from-status returns false", () => {
    expect(isValidTransition("unknown_status", "in_progress")).toBe(false);
  });

  it("unknown to-status returns false", () => {
    expect(isValidTransition("in_progress", "unknown_status")).toBe(false);
  });
});
