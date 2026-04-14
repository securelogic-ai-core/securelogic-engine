import { describe, it, expect } from "vitest";
import {
  validateDependencyCreate,
  validateDependencyUpdate,
  VALID_DEPENDENCY_TYPES,
  VALID_CRITICALITIES,
  VALID_STATUSES
} from "../lib/dependencyValidation.js";

// ====================================================================
// Helpers
// ====================================================================

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function minimalCreate() {
  return {
    name: "lodash",
    dependency_type: "software_library",
    criticality: "High"
  };
}

function validCreate(overrides: Record<string, unknown> = {}) {
  return { ...minimalCreate(), ...overrides };
}

// ====================================================================
// validateDependencyCreate — body shape
// ====================================================================

describe("validateDependencyCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateDependencyCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateDependencyCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("accepts minimal valid body", () => {
    const r = validateDependencyCreate(minimalCreate());
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateDependencyCreate — name
// ====================================================================

describe("validateDependencyCreate — name", () => {
  it("rejects missing name", () => {
    const r = validateDependencyCreate({ dependency_type: "api", criticality: "High" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects empty name", () => {
    const r = validateDependencyCreate(validCreate({ name: "   " }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("trims name whitespace", () => {
    const r = validateDependencyCreate(validCreate({ name: "  lodash  " }));
    if ("input" in r) expect(r.input.name).toBe("lodash");
  });
});

// ====================================================================
// validateDependencyCreate — dependency_type
// ====================================================================

describe("validateDependencyCreate — dependency_type", () => {
  it("rejects missing dependency_type", () => {
    const r = validateDependencyCreate({ name: "lib", criticality: "High" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("dependency_type_required");
  });

  it("rejects invalid dependency_type", () => {
    const r = validateDependencyCreate(validCreate({ dependency_type: "database" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_dependency_type");
  });

  it.each([...VALID_DEPENDENCY_TYPES])("accepts dependency_type=%s", (dt) => {
    const r = validateDependencyCreate(validCreate({ dependency_type: dt }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateDependencyCreate — criticality
// ====================================================================

describe("validateDependencyCreate — criticality", () => {
  it("rejects missing criticality", () => {
    const r = validateDependencyCreate({ name: "lib", dependency_type: "api" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("criticality_required");
  });

  it("rejects invalid criticality", () => {
    const r = validateDependencyCreate(validCreate({ criticality: "Extreme" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_criticality");
  });

  it.each([...VALID_CRITICALITIES])("accepts criticality=%s", (c) => {
    const r = validateDependencyCreate(validCreate({ criticality: c }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateDependencyCreate — status
// ====================================================================

describe("validateDependencyCreate — status", () => {
  it("defaults status to 'active' when absent", () => {
    const r = validateDependencyCreate(minimalCreate());
    if ("input" in r) expect(r.input.status).toBe("active");
  });

  it("rejects invalid status", () => {
    const r = validateDependencyCreate(validCreate({ status: "archived" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it.each([...VALID_STATUSES])("accepts status=%s", (s) => {
    const r = validateDependencyCreate(validCreate({ status: s }));
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateDependencyCreate — vendor_id
// ====================================================================

describe("validateDependencyCreate — vendor_id", () => {
  it("defaults to null when absent", () => {
    const r = validateDependencyCreate(minimalCreate());
    if ("input" in r) expect(r.input.vendor_id).toBeNull();
  });

  it("accepts null vendor_id", () => {
    const r = validateDependencyCreate(validCreate({ vendor_id: null }));
    if ("input" in r) expect(r.input.vendor_id).toBeNull();
  });

  it("accepts valid UUID vendor_id", () => {
    const r = validateDependencyCreate(validCreate({ vendor_id: VALID_UUID }));
    if ("input" in r) expect(r.input.vendor_id).toBe(VALID_UUID);
  });

  it("rejects non-UUID vendor_id", () => {
    const r = validateDependencyCreate(validCreate({ vendor_id: "not-a-uuid" }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_must_be_uuid_or_null");
  });

  it("trims UUID whitespace in vendor_id", () => {
    const r = validateDependencyCreate(validCreate({ vendor_id: `  ${VALID_UUID}  ` }));
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBe(VALID_UUID);
  });
});

// ====================================================================
// validateDependencyCreate — optional string fields
// ====================================================================

describe("validateDependencyCreate — optional string fields", () => {
  it("defaults version to null when absent", () => {
    const r = validateDependencyCreate(minimalCreate());
    if ("input" in r) expect(r.input.version).toBeNull();
  });

  it("accepts version string", () => {
    const r = validateDependencyCreate(validCreate({ version: "4.17.21" }));
    if ("input" in r) expect(r.input.version).toBe("4.17.21");
  });

  it("rejects non-string version", () => {
    const r = validateDependencyCreate(validCreate({ version: 4 }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("version_must_be_string_or_null");
  });

  it("defaults description to null when absent", () => {
    const r = validateDependencyCreate(minimalCreate());
    if ("input" in r) expect(r.input.description).toBeNull();
  });

  it("rejects non-string description", () => {
    const r = validateDependencyCreate(validCreate({ description: true }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("description_must_be_string_or_null");
  });

  it("defaults license to null when absent", () => {
    const r = validateDependencyCreate(minimalCreate());
    if ("input" in r) expect(r.input.license).toBeNull();
  });

  it("accepts license string", () => {
    const r = validateDependencyCreate(validCreate({ license: "MIT" }));
    if ("input" in r) expect(r.input.license).toBe("MIT");
  });

  it("defaults external_ref to null when absent", () => {
    const r = validateDependencyCreate(minimalCreate());
    if ("input" in r) expect(r.input.external_ref).toBeNull();
  });

  it("accepts external_ref string", () => {
    const r = validateDependencyCreate(validCreate({ external_ref: "CVE-2026-1234" }));
    if ("input" in r) expect(r.input.external_ref).toBe("CVE-2026-1234");
  });
});

// ====================================================================
// validateDependencyUpdate — body shape
// ====================================================================

describe("validateDependencyUpdate — body shape", () => {
  it("rejects null body", () => {
    const r = validateDependencyUpdate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects empty object (no known fields)", () => {
    const r = validateDependencyUpdate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("no_fields_to_update");
  });

  it("accepts partial update with a known field", () => {
    const r = validateDependencyUpdate({ status: "deprecated" });
    expect("input" in r).toBe(true);
  });
});

// ====================================================================
// validateDependencyUpdate — field validation
// ====================================================================

describe("validateDependencyUpdate — field validation", () => {
  it("rejects empty name", () => {
    const r = validateDependencyUpdate({ name: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_must_be_non_empty_string");
  });

  it("rejects invalid dependency_type", () => {
    const r = validateDependencyUpdate({ dependency_type: "queue" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_dependency_type");
  });

  it("rejects invalid criticality", () => {
    const r = validateDependencyUpdate({ criticality: "Severe" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_criticality");
  });

  it("rejects invalid status", () => {
    const r = validateDependencyUpdate({ status: "archived" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts null vendor_id to clear linkage", () => {
    const r = validateDependencyUpdate({ vendor_id: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBeNull();
  });

  it("accepts valid UUID vendor_id", () => {
    const r = validateDependencyUpdate({ vendor_id: VALID_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBe(VALID_UUID);
  });

  it("rejects non-UUID vendor_id in update", () => {
    const r = validateDependencyUpdate({ vendor_id: "bad-id" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_must_be_uuid_or_null");
  });
});
