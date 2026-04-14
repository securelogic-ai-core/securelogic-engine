import { describe, it, expect, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import { buildEvidenceSummary } from "../routes/evidence.js";
import {
  validateEvidenceCreate,
  validateEvidenceListQuery,
  VALID_SOURCE_TYPES
} from "../lib/evidenceValidation.js";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

// ====================================================================
// VALID_SOURCE_TYPES — finding is included
// ====================================================================

describe("VALID_SOURCE_TYPES — finding linkage", () => {
  it("includes finding", () => {
    expect(VALID_SOURCE_TYPES.has("finding")).toBe(true);
  });

  it("includes risk_treatment", () => {
    expect(VALID_SOURCE_TYPES.has("risk_treatment")).toBe(true);
  });

  it("includes dependency_review", () => {
    expect(VALID_SOURCE_TYPES.has("dependency_review")).toBe(true);
  });

  it("does not include manual", () => {
    expect(VALID_SOURCE_TYPES.has("manual")).toBe(false);
  });

  it("does not include risk", () => {
    expect(VALID_SOURCE_TYPES.has("risk")).toBe(false);
  });
});

// ====================================================================
// validateEvidenceCreate — finding source_type
// ====================================================================

describe("validateEvidenceCreate — finding source_type", () => {
  it("accepts source_type=finding", () => {
    const r = validateEvidenceCreate({
      source_type: "finding",
      source_id: VALID_UUID,
      title: "Remediation screenshot",
      evidence_type: "screenshot"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.source_type).toBe("finding");
      expect(r.input.evidence_type).toBe("screenshot");
    }
  });

  it("accepts all valid source types including finding", () => {
    for (const st of VALID_SOURCE_TYPES) {
      const r = validateEvidenceCreate({
        source_type: st,
        source_id: VALID_UUID,
        title: "Evidence record",
        evidence_type: "document"
      });
      expect("input" in r).toBe(true);
    }
  });

  it("rejects source_type=manual (not in enum)", () => {
    const r = validateEvidenceCreate({
      source_type: "manual",
      source_id: VALID_UUID,
      title: "T",
      evidence_type: "document"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_source_type");
  });
});

// ====================================================================
// validateEvidenceListQuery — finding source_type
// ====================================================================

describe("validateEvidenceListQuery — finding source_type", () => {
  it("accepts source_type=finding", () => {
    const r = validateEvidenceListQuery({
      source_type: "finding",
      source_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.source_type).toBe("finding");
  });

  it("rejects source_type=action (not in enum)", () => {
    const r = validateEvidenceListQuery({
      source_type: "action",
      source_id: VALID_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_source_type");
  });
});

// ====================================================================
// buildEvidenceSummary — empty input
// ====================================================================

describe("buildEvidenceSummary — empty rows", () => {
  it("returns total = 0 when no rows", () => {
    const s = buildEvidenceSummary([]);
    expect(s.total).toBe(0);
  });

  it("returns all canonical source_type keys at 0", () => {
    const { by_source_type } = buildEvidenceSummary([]);
    expect(by_source_type["control_test"]).toBe(0);
    expect(by_source_type["vendor_review"]).toBe(0);
    expect(by_source_type["ai_review"]).toBe(0);
    expect(by_source_type["obligation_review"]).toBe(0);
    expect(by_source_type["dependency_review"]).toBe(0);
    expect(by_source_type["risk_treatment"]).toBe(0);
    expect(by_source_type["finding"]).toBe(0);
  });
});

// ====================================================================
// buildEvidenceSummary — single source_type
// ====================================================================

describe("buildEvidenceSummary — single source_type populated", () => {
  it("counts control_test rows correctly", () => {
    const s = buildEvidenceSummary([
      { source_type: "control_test", count: "5" }
    ]);
    expect(s.by_source_type["control_test"]).toBe(5);
    expect(s.total).toBe(5);
  });

  it("counts finding rows correctly", () => {
    const s = buildEvidenceSummary([
      { source_type: "finding", count: "3" }
    ]);
    expect(s.by_source_type["finding"]).toBe(3);
    expect(s.total).toBe(3);
  });

  it("counts risk_treatment rows correctly", () => {
    const s = buildEvidenceSummary([
      { source_type: "risk_treatment", count: "2" }
    ]);
    expect(s.by_source_type["risk_treatment"]).toBe(2);
    expect(s.total).toBe(2);
  });

  it("leaves unpopulated source_types at 0", () => {
    const s = buildEvidenceSummary([
      { source_type: "control_test", count: "4" }
    ]);
    expect(s.by_source_type["vendor_review"]).toBe(0);
    expect(s.by_source_type["finding"]).toBe(0);
    expect(s.by_source_type["risk_treatment"]).toBe(0);
  });
});

// ====================================================================
// buildEvidenceSummary — multiple source_types
// ====================================================================

describe("buildEvidenceSummary — multiple source_types", () => {
  it("sums totals correctly across all present source_types", () => {
    const s = buildEvidenceSummary([
      { source_type: "control_test", count: "10" },
      { source_type: "vendor_review", count: "4" },
      { source_type: "finding", count: "7" }
    ]);
    expect(s.total).toBe(21);
    expect(s.by_source_type["control_test"]).toBe(10);
    expect(s.by_source_type["vendor_review"]).toBe(4);
    expect(s.by_source_type["finding"]).toBe(7);
    expect(s.by_source_type["ai_review"]).toBe(0);
  });

  it("handles all canonical source_types present", () => {
    const s = buildEvidenceSummary([
      { source_type: "control_test", count: "1" },
      { source_type: "vendor_review", count: "2" },
      { source_type: "ai_review", count: "3" },
      { source_type: "obligation_review", count: "4" },
      { source_type: "dependency_review", count: "5" },
      { source_type: "risk_treatment", count: "6" },
      { source_type: "finding", count: "7" }
    ]);
    expect(s.total).toBe(28);
    expect(s.by_source_type["control_test"]).toBe(1);
    expect(s.by_source_type["vendor_review"]).toBe(2);
    expect(s.by_source_type["ai_review"]).toBe(3);
    expect(s.by_source_type["obligation_review"]).toBe(4);
    expect(s.by_source_type["dependency_review"]).toBe(5);
    expect(s.by_source_type["risk_treatment"]).toBe(6);
    expect(s.by_source_type["finding"]).toBe(7);
  });

  it("ignores unknown source_types from DB rows", () => {
    const s = buildEvidenceSummary([
      { source_type: "control_test", count: "3" },
      { source_type: "unknown_legacy_type", count: "99" }
    ]);
    expect(s.total).toBe(3);
    expect("unknown_legacy_type" in s.by_source_type).toBe(false);
  });
});

// ====================================================================
// buildEvidenceSummary — integer parsing
// ====================================================================

describe("buildEvidenceSummary — count parsing", () => {
  it("parses count strings as integers", () => {
    const s = buildEvidenceSummary([
      { source_type: "obligation_review", count: "42" }
    ]);
    expect(typeof s.by_source_type["obligation_review"]).toBe("number");
    expect(s.by_source_type["obligation_review"]).toBe(42);
  });

  it("total is a number, not a string", () => {
    const s = buildEvidenceSummary([
      { source_type: "control_test", count: "8" }
    ]);
    expect(typeof s.total).toBe("number");
  });
});
