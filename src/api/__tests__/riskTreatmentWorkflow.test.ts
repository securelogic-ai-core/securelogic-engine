import { describe, it, expect } from "vitest";
import {
  validateRiskTreatmentCreate,
  validateRiskTreatmentStatusTransition,
  TERMINAL_STATUSES
} from "../lib/riskTreatmentValidation.js";

// ====================================================================
// Helpers
// ====================================================================

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function minimalCreate() {
  return { risk_id: VALID_UUID };
}

function validCreate(overrides: Record<string, unknown> = {}) {
  return { ...minimalCreate(), ...overrides };
}

// ====================================================================
// TERMINAL_STATUSES export
// ====================================================================

describe("TERMINAL_STATUSES", () => {
  it("includes mitigated", () => {
    expect(TERMINAL_STATUSES.has("mitigated")).toBe(true);
  });

  it("includes accepted", () => {
    expect(TERMINAL_STATUSES.has("accepted")).toBe(true);
  });

  it("includes transferred", () => {
    expect(TERMINAL_STATUSES.has("transferred")).toBe(true);
  });

  it("does not include not_started", () => {
    expect(TERMINAL_STATUSES.has("not_started")).toBe(false);
  });

  it("does not include in_progress", () => {
    expect(TERMINAL_STATUSES.has("in_progress")).toBe(false);
  });
});

// ====================================================================
// validateRiskTreatmentCreate — body shape
// ====================================================================

describe("validateRiskTreatmentCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateRiskTreatmentCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateRiskTreatmentCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateRiskTreatmentCreate("treat");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("accepts minimal valid body", () => {
    const r = validateRiskTreatmentCreate(minimalCreate());
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateRiskTreatmentCreate — risk_id
// ====================================================================

describe("validateRiskTreatmentCreate — risk_id", () => {
  it("rejects missing risk_id", () => {
    const r = validateRiskTreatmentCreate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("risk_id_required");
  });

  it("rejects empty risk_id", () => {
    const r = validateRiskTreatmentCreate({ risk_id: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("risk_id_required");
  });

  it("rejects non-UUID risk_id", () => {
    const r = validateRiskTreatmentCreate({ risk_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("risk_id_must_be_uuid");
  });

  it("accepts valid UUID risk_id", () => {
    const r = validateRiskTreatmentCreate(minimalCreate());
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.risk_id).toBe(VALID_UUID);
  });
});

// ====================================================================
// validateRiskTreatmentCreate — status
// ====================================================================

describe("validateRiskTreatmentCreate — status", () => {
  it("defaults status to 'not_started' when absent", () => {
    const r = validateRiskTreatmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.status).toBe("not_started");
  });

  it("rejects invalid status", () => {
    const r = validateRiskTreatmentCreate(validCreate({ status: "blocked" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it.each(["not_started", "in_progress", "mitigated", "accepted", "transferred"])(
    "accepts status=%s",
    (s) => {
      const r = validateRiskTreatmentCreate(validCreate({ status: s }));
      expect("input" in r).toBe(true);
    }
  );
});

// ====================================================================
// validateRiskTreatmentCreate — treatment_type
// ====================================================================

describe("validateRiskTreatmentCreate — treatment_type", () => {
  it("defaults to null when absent", () => {
    const r = validateRiskTreatmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.treatment_type).toBeNull();
  });

  it("accepts null treatment_type", () => {
    const r = validateRiskTreatmentCreate(validCreate({ treatment_type: null }));
    if ("input" in r) expect(r.input.treatment_type).toBeNull();
  });

  it("rejects invalid treatment_type", () => {
    const r = validateRiskTreatmentCreate(validCreate({ treatment_type: "ignore" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_treatment_type");
  });

  it.each(["mitigate", "accept", "transfer", "avoid"])(
    "accepts treatment_type=%s",
    (tt) => {
      const r = validateRiskTreatmentCreate(validCreate({ treatment_type: tt }));
      expect("input" in r).toBe(true);
      if ("input" in r) expect(r.input.treatment_type).toBe(tt);
    }
  );
});

// ====================================================================
// validateRiskTreatmentCreate — owner
// ====================================================================

describe("validateRiskTreatmentCreate — owner", () => {
  it("defaults to null when absent", () => {
    const r = validateRiskTreatmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.owner).toBeNull();
  });

  it("accepts string owner", () => {
    const r = validateRiskTreatmentCreate(validCreate({ owner: "Alice Smith" }));
    if ("input" in r) expect(r.input.owner).toBe("Alice Smith");
  });

  it("rejects non-string owner", () => {
    const r = validateRiskTreatmentCreate(validCreate({ owner: 42 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("owner_must_be_string_or_null");
  });

  it("normalizes whitespace-only owner to null", () => {
    const r = validateRiskTreatmentCreate(validCreate({ owner: "   " }));
    if ("input" in r) expect(r.input.owner).toBeNull();
  });
});

// ====================================================================
// validateRiskTreatmentCreate — due_date
// ====================================================================

describe("validateRiskTreatmentCreate — due_date", () => {
  it("defaults to null when absent", () => {
    const r = validateRiskTreatmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.due_date).toBeNull();
  });

  it("accepts ISO date", () => {
    const r = validateRiskTreatmentCreate(validCreate({ due_date: "2026-06-30" }));
    if ("input" in r) expect(r.input.due_date).toBe("2026-06-30");
  });

  it("rejects invalid date format", () => {
    const r = validateRiskTreatmentCreate(validCreate({ due_date: "June 30" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("due_date_invalid_format");
  });

  it("rejects non-string due_date", () => {
    const r = validateRiskTreatmentCreate(validCreate({ due_date: 20260630 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("due_date_must_be_date_string_or_null");
  });
});

// ====================================================================
// validateRiskTreatmentCreate — summary and notes
// ====================================================================

describe("validateRiskTreatmentCreate — summary and notes", () => {
  it("defaults summary to null when absent", () => {
    const r = validateRiskTreatmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.summary).toBeNull();
  });

  it("accepts string summary", () => {
    const r = validateRiskTreatmentCreate(validCreate({ summary: "Patch applied" }));
    if ("input" in r) expect(r.input.summary).toBe("Patch applied");
  });

  it("rejects non-string summary", () => {
    const r = validateRiskTreatmentCreate(validCreate({ summary: true }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("summary_must_be_string_or_null");
  });

  it("defaults notes to null when absent", () => {
    const r = validateRiskTreatmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts string notes", () => {
    const r = validateRiskTreatmentCreate(validCreate({ notes: "See ticket RISK-42" }));
    if ("input" in r) expect(r.input.notes).toBe("See ticket RISK-42");
  });

  it("rejects non-string notes", () => {
    const r = validateRiskTreatmentCreate(validCreate({ notes: [] }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_must_be_string_or_null");
  });
});

// ====================================================================
// validateRiskTreatmentCreate — performed_at
// ====================================================================

describe("validateRiskTreatmentCreate — performed_at", () => {
  it("defaults to null when absent", () => {
    const r = validateRiskTreatmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.performed_at).toBeNull();
  });

  it("accepts ISO date", () => {
    const r = validateRiskTreatmentCreate(validCreate({ performed_at: "2026-04-13" }));
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-13");
  });

  it("rejects invalid format", () => {
    const r = validateRiskTreatmentCreate(validCreate({ performed_at: "2026/04/13" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_invalid_format");
  });

  it("rejects non-string performed_at", () => {
    const r = validateRiskTreatmentCreate(validCreate({ performed_at: 20260413 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("performed_at_must_be_date_string_or_null");
  });
});

// ====================================================================
// validateRiskTreatmentCreate — reviewer_id
// ====================================================================

describe("validateRiskTreatmentCreate — reviewer_id", () => {
  it("defaults to null when absent", () => {
    const r = validateRiskTreatmentCreate(minimalCreate());
    if ("input" in r) expect(r.input.reviewer_id).toBeNull();
  });

  it("accepts valid UUID reviewer_id", () => {
    const r = validateRiskTreatmentCreate(validCreate({ reviewer_id: VALID_UUID }));
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });

  it("rejects non-UUID reviewer_id", () => {
    const r = validateRiskTreatmentCreate(validCreate({ reviewer_id: "not-uuid" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });
});

// ====================================================================
// validateRiskTreatmentStatusTransition — body shape
// ====================================================================

describe("validateRiskTreatmentStatusTransition — body shape", () => {
  it("rejects null body", () => {
    const r = validateRiskTreatmentStatusTransition(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects missing status", () => {
    const r = validateRiskTreatmentStatusTransition({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_required");
  });

  it("rejects invalid status", () => {
    const r = validateRiskTreatmentStatusTransition({ status: "resolved" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts not_started without other fields", () => {
    const r = validateRiskTreatmentStatusTransition({ status: "not_started" });
    expect("input" in r).toBe(true);
  });

  it("accepts in_progress without other fields", () => {
    const r = validateRiskTreatmentStatusTransition({ status: "in_progress" });
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateRiskTreatmentStatusTransition — terminal statuses
// ====================================================================

describe("validateRiskTreatmentStatusTransition — terminal statuses", () => {
  it.each(["mitigated", "accepted", "transferred"])(
    "accepts terminal status=%s without treatment_type",
    (s) => {
      const r = validateRiskTreatmentStatusTransition({ status: s });
      expect("input" in r).toBe(true);
      if ("input" in r) expect(r.input.status).toBe(s);
    }
  );

  it("accepts mitigated with treatment_type=mitigate", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "mitigated",
      treatment_type: "mitigate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("mitigated");
      expect(r.input.treatment_type).toBe("mitigate");
    }
  });

  it("accepts accepted with treatment_type=accept", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "accepted",
      treatment_type: "accept"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.treatment_type).toBe("accept");
  });

  it("accepts transferred with treatment_type=transfer", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "transferred",
      treatment_type: "transfer"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.treatment_type).toBe("transfer");
  });
});

// ====================================================================
// validateRiskTreatmentStatusTransition — treatment_type
// ====================================================================

describe("validateRiskTreatmentStatusTransition — treatment_type", () => {
  it("treatment_type is undefined when not in body", () => {
    const r = validateRiskTreatmentStatusTransition({ status: "in_progress" });
    if ("input" in r) expect(r.input.treatment_type).toBeUndefined();
  });

  it("accepts null treatment_type (explicit clear)", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "in_progress",
      treatment_type: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.treatment_type).toBeNull();
  });

  it("rejects invalid treatment_type on PATCH", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "in_progress",
      treatment_type: "monitor"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_treatment_type");
  });

  it.each(["mitigate", "accept", "transfer", "avoid"])(
    "accepts treatment_type=%s on PATCH",
    (tt) => {
      const r = validateRiskTreatmentStatusTransition({
        status: "in_progress",
        treatment_type: tt
      });
      expect("input" in r).toBe(true);
    }
  );
});

// ====================================================================
// validateRiskTreatmentStatusTransition — optional fields
// ====================================================================

describe("validateRiskTreatmentStatusTransition — optional fields", () => {
  it("passes owner through", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "mitigated",
      owner: "Bob Jones"
    });
    if ("input" in r) expect(r.input.owner).toBe("Bob Jones");
  });

  it("rejects non-string owner", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "in_progress",
      owner: 99
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("owner_must_be_string_or_null");
  });

  it("accepts performed_at ISO date", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "mitigated",
      performed_at: "2026-04-13"
    });
    if ("input" in r) expect(r.input.performed_at).toBe("2026-04-13");
  });

  it("rejects non-string notes", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "in_progress",
      notes: 123
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_must_be_string_or_null");
  });

  it("accepts reviewer_id UUID", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "accepted",
      reviewer_id: VALID_UUID
    });
    if ("input" in r) expect(r.input.reviewer_id).toBe(VALID_UUID);
  });

  it("rejects non-UUID reviewer_id", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "in_progress",
      reviewer_id: "not-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reviewer_id_must_be_uuid_or_null");
  });

  it("accepts due_date ISO string", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "in_progress",
      due_date: "2026-09-01"
    });
    if ("input" in r) expect(r.input.due_date).toBe("2026-09-01");
  });

  it("rejects malformed due_date", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "in_progress",
      due_date: "9/1/2026"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("due_date_invalid_format");
  });

  it("accepts summary string", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "mitigated",
      summary: "Patched CVE-2026-1234"
    });
    if ("input" in r) expect(r.input.summary).toBe("Patched CVE-2026-1234");
  });

  it("normalizes whitespace-only summary to null", () => {
    const r = validateRiskTreatmentStatusTransition({
      status: "in_progress",
      summary: "   "
    });
    if ("input" in r) expect(r.input.summary).toBeNull();
  });
});
