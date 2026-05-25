import { describe, it, expect } from "vitest";
import {
  validateFindingCreate,
  VALID_SOURCE_TYPES,
  VALID_SEVERITIES,
  VALID_PRIORITIES,
  VALID_LIKELIHOODS,
  VALID_CONFIDENCES,
  VALID_TIME_SENSITIVITIES
} from "../lib/findingValidation.js";

// ====================================================================
// Helpers
// ====================================================================

function minimal() {
  return {
    title: "Gap in access controls",
    description: "Access-control gap identified during review.",
    severity: "High",
    source_type: "manual",
  };
}

function valid(overrides: Record<string, unknown> = {}) {
  return { ...minimal(), ...overrides };
}

// ====================================================================
// validateFindingCreate — body shape
// ====================================================================

describe("validateFindingCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateFindingCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateFindingCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateFindingCreate("finding");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("accepts minimal valid body", () => {
    const r = validateFindingCreate(minimal());
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateFindingCreate — title
// ====================================================================

describe("validateFindingCreate — title", () => {
  it("rejects missing title", () => {
    const r = validateFindingCreate({ severity: "High", source_type: "manual" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("rejects empty string title", () => {
    const r = validateFindingCreate(valid({ title: "" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("rejects whitespace-only title", () => {
    const r = validateFindingCreate(valid({ title: "   " }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("trims title whitespace", () => {
    const r = validateFindingCreate(valid({ title: "  Gap  " }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.title).toBe("Gap");
  });
});

// ====================================================================
// validateFindingCreate — severity
// ====================================================================

describe("validateFindingCreate — severity", () => {
  it("rejects missing severity", () => {
    const r = validateFindingCreate({ title: "T", source_type: "manual" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("severity_required");
  });

  it("rejects invalid severity", () => {
    const r = validateFindingCreate(valid({ severity: "Extreme" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_severity");
  });

  it.each([...VALID_SEVERITIES])("accepts severity=%s", (sev) => {
    const r = validateFindingCreate(valid({ severity: sev }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateFindingCreate — source_type
// ====================================================================

describe("validateFindingCreate — source_type", () => {
  it("rejects missing source_type", () => {
    const r = validateFindingCreate({ title: "T", severity: "High" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_type_required");
  });

  it("rejects invalid source_type", () => {
    const r = validateFindingCreate(valid({ source_type: "unknown_type" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_source_type");
  });

  it.each([...VALID_SOURCE_TYPES])("accepts source_type=%s", (st) => {
    const r = validateFindingCreate(valid({ source_type: st }));
    expect("input" in r).toBe(true);
  });

  it("accepts source_type='risk'", () => {
    const r = validateFindingCreate(valid({ source_type: "risk" }));
    expect("input" in r).toBe(true);
  });

  it("accepts source_type='obligation_review'", () => {
    const r = validateFindingCreate(valid({ source_type: "obligation_review" }));
    expect("input" in r).toBe(true);
  });

  it("accepts source_type='vendor_cycle_review'", () => {
    const r = validateFindingCreate(valid({ source_type: "vendor_cycle_review" }));
    expect("input" in r).toBe(true);
  });

  it("accepts source_type='ai_governance_review'", () => {
    const r = validateFindingCreate(valid({ source_type: "ai_governance_review" }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateFindingCreate — description
// ====================================================================

describe("validateFindingCreate — description", () => {
  it("rejects a missing description", () => {
    // description is a required non-empty string (findings.description is
    // NOT NULL); a body without it must fail validation, not coerce to null.
    const r = validateFindingCreate({
      title: "Gap in access controls",
      severity: "High",
      source_type: "manual",
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("description_required");
  });

  it("rejects a null description", () => {
    const r = validateFindingCreate(valid({ description: null }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("description_required");
  });

  it("accepts a non-empty string description", () => {
    const r = validateFindingCreate(valid({ description: "Some detail" }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.description).toBe("Some detail");
  });

  it("rejects a non-string description", () => {
    const r = validateFindingCreate(valid({ description: 42 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("description_required");
  });

  it("rejects an empty / whitespace-only description", () => {
    const r = validateFindingCreate(valid({ description: "   " }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("description_required");
  });
});

// ====================================================================
// validateFindingCreate — source_id
// ====================================================================

describe("validateFindingCreate — source_id", () => {
  it("defaults source_id to null when absent", () => {
    const r = validateFindingCreate(minimal());
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.source_id).toBeNull();
  });

  it("accepts null source_id", () => {
    const r = validateFindingCreate(valid({ source_id: null }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.source_id).toBeNull();
  });

  it("accepts valid UUID source_id", () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const r = validateFindingCreate(valid({ source_id: uuid }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.source_id).toBe(uuid);
  });

  it("rejects non-UUID source_id", () => {
    const r = validateFindingCreate(valid({ source_id: "not-a-uuid" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_id_must_be_uuid_or_null");
  });

  it("trims UUID whitespace", () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const r = validateFindingCreate(valid({ source_id: `  ${uuid}  ` }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.source_id).toBe(uuid);
  });
});

// ====================================================================
// validateFindingCreate — domain
// ====================================================================

describe("validateFindingCreate — domain", () => {
  it("defaults domain to null when absent", () => {
    const r = validateFindingCreate(minimal());
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.domain).toBeNull();
  });

  it("accepts null domain", () => {
    const r = validateFindingCreate(valid({ domain: null }));
    if ("input" in r) expect(r.input.domain).toBeNull();
  });

  it("accepts string domain", () => {
    const r = validateFindingCreate(valid({ domain: "Access Control" }));
    if ("input" in r) expect(r.input.domain).toBe("Access Control");
  });

  it("rejects non-string domain", () => {
    const r = validateFindingCreate(valid({ domain: 123 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("domain_must_be_string_or_null");
  });
});

// ====================================================================
// validateFindingCreate — priority
// ====================================================================

describe("validateFindingCreate — priority", () => {
  it("defaults priority to null when absent", () => {
    const r = validateFindingCreate(minimal());
    if ("input" in r) expect(r.input.priority).toBeNull();
  });

  it("rejects invalid priority", () => {
    const r = validateFindingCreate(valid({ priority: "urgent" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_priority");
  });

  it.each([...VALID_PRIORITIES])("accepts priority=%s", (p) => {
    const r = validateFindingCreate(valid({ priority: p }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateFindingCreate — likelihood
// ====================================================================

describe("validateFindingCreate — likelihood", () => {
  it("defaults likelihood to null when absent", () => {
    const r = validateFindingCreate(minimal());
    if ("input" in r) expect(r.input.likelihood).toBeNull();
  });

  it("rejects invalid likelihood", () => {
    const r = validateFindingCreate(valid({ likelihood: "extreme" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_likelihood");
  });

  it.each([...VALID_LIKELIHOODS])("accepts likelihood=%s", (l) => {
    const r = validateFindingCreate(valid({ likelihood: l }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateFindingCreate — confidence
// ====================================================================

describe("validateFindingCreate — confidence", () => {
  it("defaults confidence to null when absent", () => {
    const r = validateFindingCreate(minimal());
    if ("input" in r) expect(r.input.confidence).toBeNull();
  });

  it("rejects invalid confidence", () => {
    const r = validateFindingCreate(valid({ confidence: "certain" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_confidence");
  });

  it.each([...VALID_CONFIDENCES])("accepts confidence=%s", (c) => {
    const r = validateFindingCreate(valid({ confidence: c }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateFindingCreate — time_sensitivity
// ====================================================================

describe("validateFindingCreate — time_sensitivity", () => {
  it("defaults time_sensitivity to null when absent", () => {
    const r = validateFindingCreate(minimal());
    if ("input" in r) expect(r.input.time_sensitivity).toBeNull();
  });

  it("rejects invalid time_sensitivity", () => {
    const r = validateFindingCreate(valid({ time_sensitivity: "critical" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_time_sensitivity");
  });

  it.each([...VALID_TIME_SENSITIVITIES])("accepts time_sensitivity=%s", (ts) => {
    const r = validateFindingCreate(valid({ time_sensitivity: ts }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateFindingCreate — scoring_rationale
// ====================================================================

describe("validateFindingCreate — scoring_rationale", () => {
  it("defaults scoring_rationale to null when absent", () => {
    const r = validateFindingCreate(minimal());
    if ("input" in r) expect(r.input.scoring_rationale).toBeNull();
  });

  it("accepts string scoring_rationale", () => {
    const r = validateFindingCreate(valid({ scoring_rationale: "Based on CVSS score" }));
    if ("input" in r) expect(r.input.scoring_rationale).toBe("Based on CVSS score");
  });

  it("rejects non-string scoring_rationale", () => {
    const r = validateFindingCreate(valid({ scoring_rationale: 42 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("scoring_rationale_must_be_string_or_null");
  });
});

// ====================================================================
// validateFindingCreate — owner_user_id
// ====================================================================

describe("validateFindingCreate — owner_user_id", () => {
  it("defaults owner_user_id to null when absent", () => {
    const r = validateFindingCreate(minimal());
    if ("input" in r) expect(r.input.owner_user_id).toBeNull();
  });

  it("accepts valid UUID owner_user_id", () => {
    const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const r = validateFindingCreate(valid({ owner_user_id: uuid }));
    if ("input" in r) expect(r.input.owner_user_id).toBe(uuid);
  });

  it("rejects non-UUID owner_user_id", () => {
    const r = validateFindingCreate(valid({ owner_user_id: "user@example.com" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("owner_user_id_must_be_uuid_or_null");
  });
});

// ====================================================================
// validateFindingCreate — due_date
// ====================================================================

describe("validateFindingCreate — due_date", () => {
  it("defaults due_date to null when absent", () => {
    const r = validateFindingCreate(minimal());
    if ("input" in r) expect(r.input.due_date).toBeNull();
  });

  it("accepts ISO date string", () => {
    const r = validateFindingCreate(valid({ due_date: "2026-12-31" }));
    if ("input" in r) expect(r.input.due_date).toBe("2026-12-31");
  });

  it("rejects non-ISO date string", () => {
    const r = validateFindingCreate(valid({ due_date: "December 31, 2026" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("due_date_must_be_iso_date_or_null");
  });

  it("rejects timestamp string", () => {
    const r = validateFindingCreate(valid({ due_date: "2026-12-31T00:00:00Z" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("due_date_must_be_iso_date_or_null");
  });
});

// ====================================================================
// validateFindingCreate — full valid input
// ====================================================================

describe("validateFindingCreate — full valid input", () => {
  it("returns all fields correctly on a fully populated body", () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ownerUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const body = {
      title: "Unpatched CVE in vendor library",
      severity: "Critical",
      source_type: "risk",
      description: "CVE-2026-1234 affects library version < 2.0",
      source_id: uuid,
      domain: "Vendor Risk",
      priority: "immediate",
      likelihood: "high",
      confidence: "high",
      time_sensitivity: "immediate",
      scoring_rationale: "CVSS 9.8, actively exploited",
      owner_user_id: ownerUuid,
      due_date: "2026-05-01"
    };
    const r = validateFindingCreate(body);
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.title).toBe("Unpatched CVE in vendor library");
      expect(r.input.severity).toBe("Critical");
      expect(r.input.source_type).toBe("risk");
      expect(r.input.source_id).toBe(uuid);
      expect(r.input.domain).toBe("Vendor Risk");
      expect(r.input.priority).toBe("immediate");
      expect(r.input.likelihood).toBe("high");
      expect(r.input.confidence).toBe("high");
      expect(r.input.time_sensitivity).toBe("immediate");
      expect(r.input.owner_user_id).toBe(ownerUuid);
      expect(r.input.due_date).toBe("2026-05-01");
    }
  });
});
