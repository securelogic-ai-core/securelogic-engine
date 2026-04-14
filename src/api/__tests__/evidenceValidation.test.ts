import { describe, it, expect } from "vitest";
import {
  validateEvidenceCreate,
  validateEvidenceListQuery,
  VALID_SOURCE_TYPES,
  VALID_EVIDENCE_TYPES
} from "../lib/evidenceValidation.js";

// ====================================================================
// Helpers
// ====================================================================

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function minimalCreate() {
  return {
    source_type: "control_test",
    source_id: VALID_UUID,
    title: "RBAC policy document",
    evidence_type: "document"
  };
}

function validCreate(overrides: Record<string, unknown> = {}) {
  return { ...minimalCreate(), ...overrides };
}

// ====================================================================
// validateEvidenceCreate — body shape
// ====================================================================

describe("validateEvidenceCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateEvidenceCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateEvidenceCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateEvidenceCreate("evidence");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("accepts minimal valid body", () => {
    const r = validateEvidenceCreate(minimalCreate());
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateEvidenceCreate — source_type
// ====================================================================

describe("validateEvidenceCreate — source_type", () => {
  it("rejects missing source_type", () => {
    const r = validateEvidenceCreate({ source_id: VALID_UUID, title: "T", evidence_type: "document" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_type_required");
  });

  it("rejects empty source_type", () => {
    const r = validateEvidenceCreate(validCreate({ source_type: "" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_type_required");
  });

  it("rejects invalid source_type", () => {
    const r = validateEvidenceCreate(validCreate({ source_type: "manual" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_source_type");
  });

  it.each([...VALID_SOURCE_TYPES])("accepts source_type=%s", (st) => {
    const r = validateEvidenceCreate(validCreate({ source_type: st }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateEvidenceCreate — source_id
// ====================================================================

describe("validateEvidenceCreate — source_id", () => {
  it("rejects missing source_id", () => {
    const r = validateEvidenceCreate({ source_type: "control_test", title: "T", evidence_type: "document" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_id_required");
  });

  it("rejects empty source_id", () => {
    const r = validateEvidenceCreate(validCreate({ source_id: "" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_id_required");
  });

  it("rejects non-UUID source_id", () => {
    const r = validateEvidenceCreate(validCreate({ source_id: "not-a-uuid" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_id_must_be_uuid");
  });

  it("accepts valid UUID source_id", () => {
    const r = validateEvidenceCreate(validCreate({ source_id: VALID_UUID }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.source_id).toBe(VALID_UUID);
  });
});

// ====================================================================
// validateEvidenceCreate — title
// ====================================================================

describe("validateEvidenceCreate — title", () => {
  it("rejects missing title", () => {
    const r = validateEvidenceCreate({ source_type: "control_test", source_id: VALID_UUID, evidence_type: "document" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("rejects empty title", () => {
    const r = validateEvidenceCreate(validCreate({ title: "   " }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("trims title whitespace", () => {
    const r = validateEvidenceCreate(validCreate({ title: "  Policy Doc  " }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.title).toBe("Policy Doc");
  });
});

// ====================================================================
// validateEvidenceCreate — evidence_type
// ====================================================================

describe("validateEvidenceCreate — evidence_type", () => {
  it("rejects missing evidence_type", () => {
    const r = validateEvidenceCreate({ source_type: "control_test", source_id: VALID_UUID, title: "T" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("evidence_type_required");
  });

  it("rejects invalid evidence_type", () => {
    const r = validateEvidenceCreate(validCreate({ evidence_type: "video" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_evidence_type");
  });

  it.each([...VALID_EVIDENCE_TYPES])("accepts evidence_type=%s", (et) => {
    const r = validateEvidenceCreate(validCreate({ evidence_type: et }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateEvidenceCreate — description
// ====================================================================

describe("validateEvidenceCreate — description", () => {
  it("defaults description to null when absent", () => {
    const r = validateEvidenceCreate(minimalCreate());
    if ("input" in r) expect(r.input.description).toBeNull();
  });

  it("accepts null description", () => {
    const r = validateEvidenceCreate(validCreate({ description: null }));
    if ("input" in r) expect(r.input.description).toBeNull();
  });

  it("accepts string description", () => {
    const r = validateEvidenceCreate(validCreate({ description: "Proof of access controls" }));
    if ("input" in r) expect(r.input.description).toBe("Proof of access controls");
  });

  it("rejects non-string description", () => {
    const r = validateEvidenceCreate(validCreate({ description: 42 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("description_must_be_string_or_null");
  });

  it("normalizes whitespace-only description to null", () => {
    const r = validateEvidenceCreate(validCreate({ description: "   " }));
    if ("input" in r) expect(r.input.description).toBeNull();
  });
});

// ====================================================================
// validateEvidenceCreate — collected_at
// ====================================================================

describe("validateEvidenceCreate — collected_at", () => {
  it("defaults collected_at to null when absent", () => {
    const r = validateEvidenceCreate(minimalCreate());
    if ("input" in r) expect(r.input.collected_at).toBeNull();
  });

  it("accepts null collected_at", () => {
    const r = validateEvidenceCreate(validCreate({ collected_at: null }));
    if ("input" in r) expect(r.input.collected_at).toBeNull();
  });

  it("accepts ISO date collected_at", () => {
    const r = validateEvidenceCreate(validCreate({ collected_at: "2026-04-13" }));
    if ("input" in r) expect(r.input.collected_at).toBe("2026-04-13");
  });

  it("rejects non-ISO date format", () => {
    const r = validateEvidenceCreate(validCreate({ collected_at: "April 13, 2026" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("collected_at_invalid_format");
  });

  it("rejects non-string collected_at", () => {
    const r = validateEvidenceCreate(validCreate({ collected_at: 20260413 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("collected_at_must_be_date_string_or_null");
  });
});

// ====================================================================
// validateEvidenceCreate — collected_by
// ====================================================================

describe("validateEvidenceCreate — collected_by", () => {
  it("defaults collected_by to null when absent", () => {
    const r = validateEvidenceCreate(minimalCreate());
    if ("input" in r) expect(r.input.collected_by).toBeNull();
  });

  it("accepts string collected_by", () => {
    const r = validateEvidenceCreate(validCreate({ collected_by: "Alice Smith" }));
    if ("input" in r) expect(r.input.collected_by).toBe("Alice Smith");
  });

  it("rejects non-string collected_by", () => {
    const r = validateEvidenceCreate(validCreate({ collected_by: true }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("collected_by_must_be_string_or_null");
  });

  it("normalizes whitespace-only to null", () => {
    const r = validateEvidenceCreate(validCreate({ collected_by: "  " }));
    if ("input" in r) expect(r.input.collected_by).toBeNull();
  });
});

// ====================================================================
// validateEvidenceCreate — external_ref
// ====================================================================

describe("validateEvidenceCreate — external_ref", () => {
  it("defaults external_ref to null when absent", () => {
    const r = validateEvidenceCreate(minimalCreate());
    if ("input" in r) expect(r.input.external_ref).toBeNull();
  });

  it("accepts string external_ref", () => {
    const r = validateEvidenceCreate(validCreate({ external_ref: "JIRA-1234" }));
    if ("input" in r) expect(r.input.external_ref).toBe("JIRA-1234");
  });

  it("rejects non-string external_ref", () => {
    const r = validateEvidenceCreate(validCreate({ external_ref: [] }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("external_ref_must_be_string_or_null");
  });
});

// ====================================================================
// validateEvidenceCreate — full valid body
// ====================================================================

describe("validateEvidenceCreate — full valid body", () => {
  it("returns all fields on a fully populated body", () => {
    const body = {
      source_type: "vendor_review",
      source_id: VALID_UUID,
      title: "SOC 2 Type II Report",
      description: "Annual audit report from auditor",
      evidence_type: "document",
      collected_at: "2026-03-15",
      collected_by: "Compliance Team",
      external_ref: "DRIVE-SOC2-2026"
    };
    const r = validateEvidenceCreate(body);
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.source_type).toBe("vendor_review");
      expect(r.input.source_id).toBe(VALID_UUID);
      expect(r.input.title).toBe("SOC 2 Type II Report");
      expect(r.input.description).toBe("Annual audit report from auditor");
      expect(r.input.evidence_type).toBe("document");
      expect(r.input.collected_at).toBe("2026-03-15");
      expect(r.input.collected_by).toBe("Compliance Team");
      expect(r.input.external_ref).toBe("DRIVE-SOC2-2026");
    }
  });
});

// ====================================================================
// validateEvidenceListQuery — shape
// ====================================================================

describe("validateEvidenceListQuery — body shape", () => {
  it("rejects null query", () => {
    const r = validateEvidenceListQuery(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("query_params_required");
  });

  it("rejects array query", () => {
    const r = validateEvidenceListQuery([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("query_params_required");
  });

  it("accepts valid query params", () => {
    const r = validateEvidenceListQuery({ source_type: "control_test", source_id: VALID_UUID });
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateEvidenceListQuery — source_type
// ====================================================================

describe("validateEvidenceListQuery — source_type", () => {
  it("rejects missing source_type", () => {
    const r = validateEvidenceListQuery({ source_id: VALID_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_type_required");
  });

  it("rejects invalid source_type", () => {
    const r = validateEvidenceListQuery({ source_type: "manual", source_id: VALID_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_source_type");
  });

  it.each([...VALID_SOURCE_TYPES])("accepts source_type=%s", (st) => {
    const r = validateEvidenceListQuery({ source_type: st, source_id: VALID_UUID });
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateEvidenceListQuery — source_id
// ====================================================================

describe("validateEvidenceListQuery — source_id", () => {
  it("rejects missing source_id", () => {
    const r = validateEvidenceListQuery({ source_type: "control_test" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_id_required");
  });

  it("rejects non-UUID source_id", () => {
    const r = validateEvidenceListQuery({ source_type: "control_test", source_id: "not-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_id_must_be_uuid");
  });

  it("accepts valid UUID source_id", () => {
    const r = validateEvidenceListQuery({ source_type: "control_test", source_id: VALID_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.source_type).toBe("control_test");
      expect(r.input.source_id).toBe(VALID_UUID);
    }
  });
});
