import { describe, it, expect } from "vitest";
import { validateRequirementResponseUpsert } from "../lib/requirementResponseValidation.js";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_ORG_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const VALID_REQ_UUID = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const VALID_VENDOR_UUID = "d4e5f6a7-b8c9-0123-def0-234567890123";

// ─────────────────────────────────────────────────────────────────────────────
// Body shape
// ─────────────────────────────────────────────────────────────────────────────

describe("validateRequirementResponseUpsert — body shape", () => {
  it("rejects null body", () => {
    const r = validateRequirementResponseUpsert(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateRequirementResponseUpsert("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateRequirementResponseUpsert([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requirement_id
// ─────────────────────────────────────────────────────────────────────────────

describe("validateRequirementResponseUpsert — requirement_id", () => {
  it("rejects missing requirement_id", () => {
    const r = validateRequirementResponseUpsert({
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("requirement_id_required");
  });

  it("rejects empty requirement_id", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: "",
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("requirement_id_required");
  });

  it("rejects non-UUID requirement_id", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: "not-a-uuid",
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("requirement_id_must_be_uuid");
  });

  it("accepts a valid UUID requirement_id", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.requirement_id).toBe(VALID_REQ_UUID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assessment_type
// ─────────────────────────────────────────────────────────────────────────────

describe("validateRequirementResponseUpsert — assessment_type", () => {
  it("rejects missing assessment_type", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      subject_id: VALID_ORG_UUID,
      status: "pass"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("assessment_type_required");
  });

  it("rejects invalid assessment_type", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "external",
      subject_id: VALID_ORG_UUID,
      status: "pass"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_assessment_type");
  });

  it("accepts 'self'", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.assessment_type).toBe("self");
  });

  it("accepts 'vendor'", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "vendor",
      subject_id: VALID_VENDOR_UUID,
      status: "pass"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.assessment_type).toBe("vendor");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// subject_id
// ─────────────────────────────────────────────────────────────────────────────

describe("validateRequirementResponseUpsert — subject_id", () => {
  it("rejects missing subject_id", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      status: "pass"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("subject_id_required");
  });

  it("rejects non-UUID subject_id", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: "not-a-uuid",
      status: "pass"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("subject_id_must_be_uuid");
  });

  it("accepts a valid UUID subject_id", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.subject_id).toBe(VALID_ORG_UUID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// status
// ─────────────────────────────────────────────────────────────────────────────

describe("validateRequirementResponseUpsert — status", () => {
  it("rejects missing status", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("status_required");
  });

  it("rejects invalid status", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "unknown"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts 'pass'", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("pass");
  });

  it("accepts 'fail'", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "fail"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("fail");
  });

  it("accepts 'partial'", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "partial"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("partial");
  });

  it("accepts 'not_assessed'", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "not_assessed"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("not_assessed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// notes
// ─────────────────────────────────────────────────────────────────────────────

describe("validateRequirementResponseUpsert — notes", () => {
  it("defaults to null when not provided", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts null notes", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass",
      notes: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBeNull();
  });

  it("accepts and trims a string notes value", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass",
      notes: "  Control reviewed and passed audit.  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.notes).toBe("Control reviewed and passed audit.");
  });

  it("rejects non-string, non-null notes", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass",
      notes: 42
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("notes_must_be_string_or_null");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evidence_url
// ─────────────────────────────────────────────────────────────────────────────

describe("validateRequirementResponseUpsert — evidence_url", () => {
  it("defaults to null when not provided", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.evidence_url).toBeNull();
  });

  it("accepts a string evidence_url", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass",
      evidence_url: "https://docs.example.com/evidence/soc2-report.pdf"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.evidence_url).toBe("https://docs.example.com/evidence/soc2-report.pdf");
  });

  it("rejects non-string, non-null evidence_url", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "pass",
      evidence_url: 123
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("evidence_url_must_be_string_or_null");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Minimal and full valid bodies
// ─────────────────────────────────────────────────────────────────────────────

describe("validateRequirementResponseUpsert — minimal valid body", () => {
  it("accepts required fields only", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "partial"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.requirement_id).toBe(VALID_REQ_UUID);
      expect(r.input.assessment_type).toBe("self");
      expect(r.input.subject_id).toBe(VALID_ORG_UUID);
      expect(r.input.status).toBe("partial");
      expect(r.input.notes).toBeNull();
      expect(r.input.evidence_url).toBeNull();
    }
  });
});

describe("validateRequirementResponseUpsert — full valid body", () => {
  it("accepts all fields for a vendor assessment", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_REQ_UUID,
      assessment_type: "vendor",
      subject_id: VALID_VENDOR_UUID,
      status: "fail",
      notes: "Vendor failed to provide evidence of MFA enforcement.",
      evidence_url: "https://docs.example.com/vendor-audit.pdf"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.requirement_id).toBe(VALID_REQ_UUID);
      expect(r.input.assessment_type).toBe("vendor");
      expect(r.input.subject_id).toBe(VALID_VENDOR_UUID);
      expect(r.input.status).toBe("fail");
      expect(r.input.notes).toBe("Vendor failed to provide evidence of MFA enforcement.");
      expect(r.input.evidence_url).toBe("https://docs.example.com/vendor-audit.pdf");
    }
  });

  it("accepts all fields for a self assessment with not_assessed", () => {
    const r = validateRequirementResponseUpsert({
      requirement_id: VALID_UUID,
      assessment_type: "self",
      subject_id: VALID_ORG_UUID,
      status: "not_assessed",
      notes: "Not yet reviewed.",
      evidence_url: null
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("not_assessed");
      expect(r.input.notes).toBe("Not yet reviewed.");
      expect(r.input.evidence_url).toBeNull();
    }
  });
});
