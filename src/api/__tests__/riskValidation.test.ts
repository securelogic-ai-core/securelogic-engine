import { describe, it, expect } from "vitest";
import {
  validateRiskCreate,
  validateRiskUpdate,
  validateRiskListQuery,
  VALID_LIKELIHOODS,
  VALID_IMPACTS,
  VALID_RISK_RATINGS,
  VALID_STATUSES
} from "../lib/riskValidation.js";

// ====================================================================
// Helpers
// ====================================================================

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function minimalCreate() {
  // Includes the 6 inherent/residual fields added in package
  // risk-register-inherent-residual-rating (Phase 1). Legacy
  // likelihood/impact/risk_rating are still required by the create
  // validator alongside the new fields, per the Phase-1 spec —
  // they're written to the legacy columns by the POST handler so
  // existing webhook payload contracts stay intact.
  return {
    title: "Unpatched server vulnerability",
    domain: "Vulnerability",
    likelihood: "likely",
    impact: "High",
    risk_rating: "High",
    inherent_likelihood: "likely",
    inherent_impact: "High",
    inherent_rating: "High",
    residual_likelihood: "likely",
    residual_impact: "High",
    residual_rating: "High"
  };
}

function validCreate(overrides: Record<string, unknown> = {}) {
  return { ...minimalCreate(), ...overrides };
}

// ====================================================================
// validateRiskCreate — body shape
// ====================================================================

describe("validateRiskCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateRiskCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateRiskCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("accepts minimal valid body", () => {
    const r = validateRiskCreate(minimalCreate());
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateRiskCreate — title
// ====================================================================

describe("validateRiskCreate — title", () => {
  it("rejects missing title", () => {
    const { title: _, ...rest } = minimalCreate();
    const r = validateRiskCreate(rest);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("rejects empty title", () => {
    const r = validateRiskCreate(validCreate({ title: "   " }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("trims title whitespace", () => {
    const r = validateRiskCreate(validCreate({ title: "  Risk Title  " }));
    if ("input" in r) expect(r.input.title).toBe("Risk Title");
  });
});

// ====================================================================
// validateRiskCreate — domain
// ====================================================================

describe("validateRiskCreate — domain", () => {
  it("rejects missing domain", () => {
    const { domain: _, ...rest } = minimalCreate();
    const r = validateRiskCreate(rest);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("domain_required");
  });

  it("accepts non-canonical domain (domain is non-exhaustive)", () => {
    const r = validateRiskCreate(validCreate({ domain: "Custom Domain" }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.domain).toBe("Custom Domain");
  });

  it("trims domain whitespace", () => {
    const r = validateRiskCreate(validCreate({ domain: "  Vendor Risk  " }));
    if ("input" in r) expect(r.input.domain).toBe("Vendor Risk");
  });
});

// ====================================================================
// validateRiskCreate — likelihood
// ====================================================================

describe("validateRiskCreate — likelihood", () => {
  it("rejects missing likelihood", () => {
    const { likelihood: _, ...rest } = minimalCreate();
    const r = validateRiskCreate(rest);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("likelihood_required");
  });

  it("rejects invalid likelihood", () => {
    const r = validateRiskCreate(validCreate({ likelihood: "certain" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_likelihood");
  });

  it.each([...VALID_LIKELIHOODS])("accepts likelihood=%s", (l) => {
    const r = validateRiskCreate(validCreate({ likelihood: l }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateRiskCreate — impact
// ====================================================================

describe("validateRiskCreate — impact", () => {
  it("rejects missing impact", () => {
    const { impact: _, ...rest } = minimalCreate();
    const r = validateRiskCreate(rest);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("impact_required");
  });

  it("rejects invalid impact", () => {
    const r = validateRiskCreate(validCreate({ impact: "Extreme" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_impact");
  });

  it.each([...VALID_IMPACTS])("accepts impact=%s", (i) => {
    const r = validateRiskCreate(validCreate({ impact: i }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateRiskCreate — risk_rating
// ====================================================================

describe("validateRiskCreate — risk_rating", () => {
  it("rejects missing risk_rating", () => {
    const { risk_rating: _, ...rest } = minimalCreate();
    const r = validateRiskCreate(rest);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("risk_rating_required");
  });

  it("rejects invalid risk_rating", () => {
    const r = validateRiskCreate(validCreate({ risk_rating: "Severe" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_risk_rating");
  });

  it.each([...VALID_RISK_RATINGS])("accepts risk_rating=%s", (rr) => {
    const r = validateRiskCreate(validCreate({ risk_rating: rr }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateRiskCreate — status
// ====================================================================

describe("validateRiskCreate — status", () => {
  it("defaults status to 'open' when absent", () => {
    const r = validateRiskCreate(minimalCreate());
    if ("input" in r) expect(r.input.status).toBe("open");
  });

  it("rejects invalid status", () => {
    const r = validateRiskCreate(validCreate({ status: "pending" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it.each([...VALID_STATUSES])("accepts status=%s", (s) => {
    const r = validateRiskCreate(validCreate({ status: s }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateRiskCreate — description
// ====================================================================

describe("validateRiskCreate — description", () => {
  it("defaults to null when absent", () => {
    const r = validateRiskCreate(minimalCreate());
    if ("input" in r) expect(r.input.description).toBeNull();
  });

  it("accepts string description", () => {
    const r = validateRiskCreate(validCreate({ description: "Details about risk" }));
    if ("input" in r) expect(r.input.description).toBe("Details about risk");
  });

  it("rejects non-string description", () => {
    const r = validateRiskCreate(validCreate({ description: 42 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("description_must_be_string_or_null");
  });
});

// ====================================================================
// validateRiskCreate — due_date
// ====================================================================

describe("validateRiskCreate — due_date", () => {
  it("defaults to null when absent", () => {
    const r = validateRiskCreate(minimalCreate());
    if ("input" in r) expect(r.input.due_date).toBeNull();
  });

  it("accepts ISO date", () => {
    const r = validateRiskCreate(validCreate({ due_date: "2026-12-31" }));
    if ("input" in r) expect(r.input.due_date).toBe("2026-12-31");
  });

  it("rejects invalid date format", () => {
    const r = validateRiskCreate(validCreate({ due_date: "31/12/2026" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("due_date_invalid_format");
  });

  it("rejects non-string due_date", () => {
    const r = validateRiskCreate(validCreate({ due_date: 20261231 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("due_date_must_be_date_string_or_null");
  });
});

// ====================================================================
// validateRiskCreate — source_type + source_id linkage
// ====================================================================

describe("validateRiskCreate — source_type + source_id linkage", () => {
  it("accepts both absent (no source)", () => {
    const r = validateRiskCreate(minimalCreate());
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.source_type).toBeNull();
      expect(r.input.source_id).toBeNull();
    }
  });

  it("accepts both present together", () => {
    const r = validateRiskCreate(validCreate({ source_type: "finding", source_id: VALID_UUID }));
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.source_type).toBe("finding");
      expect(r.input.source_id).toBe(VALID_UUID);
    }
  });

  it("rejects source_type without source_id", () => {
    const r = validateRiskCreate(validCreate({ source_type: "finding" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_type_and_source_id_must_be_provided_together");
  });

  it("rejects source_id without source_type", () => {
    const r = validateRiskCreate(validCreate({ source_id: VALID_UUID }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_type_and_source_id_must_be_provided_together");
  });

  it("rejects non-UUID source_id", () => {
    const r = validateRiskCreate(validCreate({ source_type: "finding", source_id: "bad-id" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_id_must_be_uuid");
  });
});

// ====================================================================
// validateRiskUpdate — body shape
// ====================================================================

describe("validateRiskUpdate — body shape", () => {
  it("rejects null body", () => {
    const r = validateRiskUpdate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects empty object (no known fields)", () => {
    const r = validateRiskUpdate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("no_fields_to_update");
  });

  it("accepts partial update with known field", () => {
    const r = validateRiskUpdate({ status: "accepted" });
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateRiskUpdate — field validation
// ====================================================================

describe("validateRiskUpdate — field validation", () => {
  it("rejects empty title", () => {
    const r = validateRiskUpdate({ title: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_must_be_non_empty_string");
  });

  it("rejects invalid likelihood", () => {
    const r = validateRiskUpdate({ likelihood: "inevitable" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_likelihood");
  });

  it("rejects invalid status", () => {
    const r = validateRiskUpdate({ status: "unknown" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts null due_date to clear the field", () => {
    const r = validateRiskUpdate({ due_date: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.due_date).toBeNull();
  });

  it("rejects source_type without source_id in update", () => {
    const r = validateRiskUpdate({ source_type: "finding" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("source_type_and_source_id_must_be_updated_together");
  });

  it("accepts null/null source pair to clear linkage", () => {
    const r = validateRiskUpdate({ source_type: null, source_id: null });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.source_type).toBeNull();
      expect(r.input.source_id).toBeNull();
    }
  });
});

// ====================================================================
// validateRiskListQuery — filters
// ====================================================================

describe("validateRiskListQuery — query params", () => {
  it("accepts empty query (all defaults)", () => {
    const r = validateRiskListQuery({});
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBeNull();
      expect(r.input.domain).toBeNull();
      expect(r.input.risk_rating).toBeNull();
      expect(r.input.limit).toBe(25);
    }
  });

  it("rejects invalid status filter", () => {
    const r = validateRiskListQuery({ status: "pending" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status_filter");
  });

  it("rejects invalid risk_rating filter", () => {
    const r = validateRiskListQuery({ risk_rating: "Extreme" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_risk_rating_filter");
  });

  it("rejects partial cursor (before_created_at without before_id)", () => {
    const r = validateRiskListQuery({ before_created_at: "2026-01-01T00:00:00Z" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cursor_requires_both_before_created_at_and_before_id");
  });

  it("rejects before_id that is not a UUID", () => {
    const r = validateRiskListQuery({ before_created_at: "2026-01-01T00:00:00Z", before_id: "not-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("before_id_must_be_uuid");
  });

  it("accepts valid status filter", () => {
    const r = validateRiskListQuery({ status: "open" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("open");
  });

  it("accepts valid cursor pair", () => {
    const r = validateRiskListQuery({
      before_created_at: "2026-01-01T00:00:00Z",
      before_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.before_created_at).toBe("2026-01-01T00:00:00Z");
      expect(r.input.before_id).toBe(VALID_UUID);
    }
  });

  it("clamps limit to MAX_LIMIT=100", () => {
    const r = validateRiskListQuery({ limit: "999" });
    if ("input" in r) expect(r.input.limit).toBe(100);
  });

  it("uses DEFAULT_LIMIT=25 for invalid limit", () => {
    const r = validateRiskListQuery({ limit: "abc" });
    if ("input" in r) expect(r.input.limit).toBe(25);
  });
});

// ====================================================================
// Inherent / Residual rating fields — Phase 1 of
// risk-register-inherent-residual-rating package
// ====================================================================

describe("validateRiskCreate — inherent fields required", () => {
  it("rejects missing inherent_likelihood", () => {
    const b = validCreate(); delete (b as Record<string, unknown>)["inherent_likelihood"];
    const r = validateRiskCreate(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("inherent_likelihood_required");
  });

  it("rejects missing inherent_impact", () => {
    const b = validCreate(); delete (b as Record<string, unknown>)["inherent_impact"];
    const r = validateRiskCreate(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("inherent_impact_required");
  });

  it("rejects missing inherent_rating", () => {
    const b = validCreate(); delete (b as Record<string, unknown>)["inherent_rating"];
    const r = validateRiskCreate(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("inherent_rating_required");
  });

  it("rejects invalid inherent_likelihood enum value", () => {
    const r = validateRiskCreate(validCreate({ inherent_likelihood: "certain" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_inherent_likelihood");
  });

  it("rejects invalid inherent_impact enum value", () => {
    const r = validateRiskCreate(validCreate({ inherent_impact: "Severe" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_inherent_impact");
  });

  it("rejects invalid inherent_rating enum value", () => {
    const r = validateRiskCreate(validCreate({ inherent_rating: "Extreme" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_inherent_rating");
  });

  it("accepts inherent values different from residual values", () => {
    // Inherent is pre-controls (worse); residual is post-controls
    // (better). The validator must permit any combination.
    const r = validateRiskCreate(validCreate({
      inherent_likelihood: "very_likely",
      inherent_impact: "Critical",
      inherent_rating: "Critical",
      residual_likelihood: "unlikely",
      residual_impact: "Low",
      residual_rating: "Low",
    }));
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.inherent_rating).toBe("Critical");
      expect(r.input.residual_rating).toBe("Low");
    }
  });
});

describe("validateRiskCreate — residual fields required", () => {
  it("rejects missing residual_likelihood", () => {
    const b = validCreate(); delete (b as Record<string, unknown>)["residual_likelihood"];
    const r = validateRiskCreate(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("residual_likelihood_required");
  });

  it("rejects missing residual_impact", () => {
    const b = validCreate(); delete (b as Record<string, unknown>)["residual_impact"];
    const r = validateRiskCreate(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("residual_impact_required");
  });

  it("rejects missing residual_rating", () => {
    const b = validCreate(); delete (b as Record<string, unknown>)["residual_rating"];
    const r = validateRiskCreate(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("residual_rating_required");
  });

  it("rejects invalid residual_likelihood enum value", () => {
    const r = validateRiskCreate(validCreate({ residual_likelihood: "frequent" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_residual_likelihood");
  });

  it("rejects invalid residual_impact enum value", () => {
    const r = validateRiskCreate(validCreate({ residual_impact: "minor" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_residual_impact");
  });

  it("rejects invalid residual_rating enum value", () => {
    const r = validateRiskCreate(validCreate({ residual_rating: "negligible" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_residual_rating");
  });
});

describe("validateRiskCreate — full body returns all 6 new fields", () => {
  it("happy path passes through inherent + residual values verbatim", () => {
    const r = validateRiskCreate(validCreate());
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.inherent_likelihood).toBe("likely");
      expect(r.input.inherent_impact).toBe("High");
      expect(r.input.inherent_rating).toBe("High");
      expect(r.input.residual_likelihood).toBe("likely");
      expect(r.input.residual_impact).toBe("High");
      expect(r.input.residual_rating).toBe("High");
    }
  });
});

describe("validateRiskUpdate — inherent fields optional", () => {
  it("accepts partial update with only inherent_rating", () => {
    const r = validateRiskUpdate({ inherent_rating: "Low" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.inherent_rating).toBe("Low");
  });

  it("accepts inherent trio update", () => {
    const r = validateRiskUpdate({
      inherent_likelihood: "rare",
      inherent_impact: "Low",
      inherent_rating: "Low",
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.inherent_likelihood).toBe("rare");
      expect(r.input.inherent_impact).toBe("Low");
      expect(r.input.inherent_rating).toBe("Low");
    }
  });

  it("rejects invalid inherent_likelihood on update", () => {
    const r = validateRiskUpdate({ inherent_likelihood: "always" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_inherent_likelihood");
  });

  it("rejects invalid inherent_rating on update", () => {
    const r = validateRiskUpdate({ inherent_rating: "Severe" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_inherent_rating");
  });

  it("rejects empty-string inherent_rating on update", () => {
    const r = validateRiskUpdate({ inherent_rating: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("inherent_rating_must_be_non_empty_string");
  });
});

describe("validateRiskUpdate — residual fields optional", () => {
  it("accepts partial update with only residual_rating", () => {
    const r = validateRiskUpdate({ residual_rating: "Moderate" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.residual_rating).toBe("Moderate");
  });

  it("accepts residual trio update", () => {
    const r = validateRiskUpdate({
      residual_likelihood: "unlikely",
      residual_impact: "Moderate",
      residual_rating: "Moderate",
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.residual_likelihood).toBe("unlikely");
      expect(r.input.residual_impact).toBe("Moderate");
      expect(r.input.residual_rating).toBe("Moderate");
    }
  });

  it("rejects invalid residual_impact on update", () => {
    const r = validateRiskUpdate({ residual_impact: "tiny" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_residual_impact");
  });

  it("rejects invalid residual_rating on update", () => {
    const r = validateRiskUpdate({ residual_rating: "Extreme" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_residual_rating");
  });
});

describe("validateRiskUpdate — KNOWN_FIELDS includes new fields", () => {
  it("accepts update with only inherent fields", () => {
    const r = validateRiskUpdate({
      inherent_likelihood: "likely",
      inherent_impact: "High",
      inherent_rating: "High",
    });
    // No legacy fields supplied. Should not return no_fields_to_update.
    expect("input" in r).toBe(true);
  });

  it("accepts update with only residual fields", () => {
    const r = validateRiskUpdate({
      residual_likelihood: "likely",
      residual_impact: "High",
      residual_rating: "High",
    });
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// owner_user_id — validators accept UUID, null, and reject garbage
// (RR-2: risk owner as FK to users.id)
// ====================================================================

describe("validateRiskCreate — owner_user_id", () => {
  it("accepts a valid UUID", () => {
    const r = validateRiskCreate(validCreate({ owner_user_id: VALID_UUID }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBe(VALID_UUID);
  });

  it("accepts null", () => {
    const r = validateRiskCreate(validCreate({ owner_user_id: null }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBe(null);
  });

  it("defaults to null when absent", () => {
    const r = validateRiskCreate(validCreate());
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBe(null);
  });

  it("rejects a non-UUID string", () => {
    const r = validateRiskCreate(validCreate({ owner_user_id: "not-a-uuid" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("owner_user_id_must_be_uuid_or_null");
  });
});

describe("validateRiskUpdate — owner_user_id", () => {
  it("accepts a valid UUID", () => {
    const r = validateRiskUpdate({ owner_user_id: VALID_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBe(VALID_UUID);
  });

  it("accepts null (clear FK)", () => {
    const r = validateRiskUpdate({ owner_user_id: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBe(null);
  });

  it("treats absent owner_user_id as undefined (no update)", () => {
    const r = validateRiskUpdate({ title: "renamed" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBeUndefined();
  });

  it("rejects a non-UUID string", () => {
    const r = validateRiskUpdate({ owner_user_id: "garbage" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("owner_user_id_must_be_uuid_or_null");
  });
});
