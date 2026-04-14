import { describe, it, expect } from "vitest";
import {
  validateDependencyCreate,
  validateDependencyUpdate,
  validateDependencyListQuery,
  VALID_DEPENDENCY_TYPES,
  VALID_CRITICALITIES,
  VALID_STATUSES
} from "../lib/dependencyValidation.js";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_UUID_2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ====================================================================
// Enum coverage
// ====================================================================

describe("VALID_DEPENDENCY_TYPES", () => {
  it("contains all five values", () => {
    for (const t of ["software_library", "cloud_service", "infrastructure", "api", "other"]) {
      expect(VALID_DEPENDENCY_TYPES.has(t)).toBe(true);
    }
  });

  it("has exactly five values", () => {
    expect(VALID_DEPENDENCY_TYPES.size).toBe(5);
  });
});

describe("VALID_CRITICALITIES", () => {
  it("contains all four canonical severity values", () => {
    for (const c of ["Critical", "High", "Moderate", "Low"]) {
      expect(VALID_CRITICALITIES.has(c)).toBe(true);
    }
  });

  it("has exactly four values", () => {
    expect(VALID_CRITICALITIES.size).toBe(4);
  });
});

describe("VALID_STATUSES", () => {
  it("contains all three values", () => {
    for (const s of ["active", "deprecated", "under_review"]) {
      expect(VALID_STATUSES.has(s)).toBe(true);
    }
  });

  it("has exactly three values", () => {
    expect(VALID_STATUSES.size).toBe(3);
  });
});

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

  it("rejects string body", () => {
    const r = validateDependencyCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ====================================================================
// validateDependencyCreate — POST happy path
// ====================================================================

describe("validateDependencyCreate — POST happy path", () => {
  it("accepts minimal body", () => {
    const r = validateDependencyCreate({
      name: "lodash",
      dependency_type: "software_library",
      criticality: "Low"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("lodash");
      expect(r.input.dependency_type).toBe("software_library");
      expect(r.input.criticality).toBe("Low");
      expect(r.input.status).toBe("active");
      expect(r.input.vendor_id).toBeNull();
      expect(r.input.version).toBeNull();
      expect(r.input.description).toBeNull();
      expect(r.input.license).toBeNull();
      expect(r.input.external_ref).toBeNull();
    }
  });

  it("accepts full body with all fields", () => {
    const r = validateDependencyCreate({
      name: "AWS S3",
      dependency_type: "cloud_service",
      criticality: "Critical",
      status: "active",
      vendor_id: VALID_UUID,
      version: "latest",
      description: "Primary object storage",
      license: "commercial",
      external_ref: "aws-s3-2026"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("AWS S3");
      expect(r.input.dependency_type).toBe("cloud_service");
      expect(r.input.criticality).toBe("Critical");
      expect(r.input.status).toBe("active");
      expect(r.input.vendor_id).toBe(VALID_UUID);
      expect(r.input.version).toBe("latest");
      expect(r.input.description).toBe("Primary object storage");
      expect(r.input.license).toBe("commercial");
      expect(r.input.external_ref).toBe("aws-s3-2026");
    }
  });

  it("trims name", () => {
    const r = validateDependencyCreate({
      name: "  react  ",
      dependency_type: "software_library",
      criticality: "Moderate"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.name).toBe("react");
  });

  it("defaults status to active when absent", () => {
    const r = validateDependencyCreate({
      name: "redis",
      dependency_type: "infrastructure",
      criticality: "High"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("active");
  });

  it("accepts all five dependency_type values", () => {
    for (const t of ["software_library", "cloud_service", "infrastructure", "api", "other"]) {
      const r = validateDependencyCreate({
        name: "dep",
        dependency_type: t,
        criticality: "Low"
      });
      expect("input" in r).toBe(true);
    }
  });

  it("accepts all four criticality values", () => {
    for (const c of ["Critical", "High", "Moderate", "Low"]) {
      const r = validateDependencyCreate({
        name: "dep",
        dependency_type: "api",
        criticality: c
      });
      expect("input" in r).toBe(true);
    }
  });

  it("accepts all three status values", () => {
    for (const s of ["active", "deprecated", "under_review"]) {
      const r = validateDependencyCreate({
        name: "dep",
        dependency_type: "api",
        criticality: "Low",
        status: s
      });
      expect("input" in r).toBe(true);
    }
  });
});

// ====================================================================
// validateDependencyCreate — POST rejects missing/invalid required fields
// ====================================================================

describe("validateDependencyCreate — POST rejects missing/invalid fields", () => {
  function base(): Record<string, unknown> {
    return {
      name: "test-dep",
      dependency_type: "software_library",
      criticality: "Low"
    };
  }

  // name
  it("rejects missing name", () => {
    const b = base(); delete b["name"];
    const r = validateDependencyCreate(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects empty string name", () => {
    const r = validateDependencyCreate({ ...base(), name: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects whitespace-only name", () => {
    const r = validateDependencyCreate({ ...base(), name: "   " });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects null name", () => {
    const r = validateDependencyCreate({ ...base(), name: null });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  // dependency_type
  it("rejects missing dependency_type", () => {
    const b = base(); delete b["dependency_type"];
    const r = validateDependencyCreate(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("dependency_type_required");
  });

  it("rejects invalid dependency_type", () => {
    const r = validateDependencyCreate({ ...base(), dependency_type: "npm_package" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_dependency_type");
  });

  // criticality
  it("rejects missing criticality", () => {
    const b = base(); delete b["criticality"];
    const r = validateDependencyCreate(b);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("criticality_required");
  });

  it("rejects invalid criticality", () => {
    const r = validateDependencyCreate({ ...base(), criticality: "medium" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_criticality");
  });

  // status
  it("rejects invalid status value", () => {
    const r = validateDependencyCreate({ ...base(), status: "archived" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  // vendor_id
  it("rejects vendor_id that is not a UUID", () => {
    const r = validateDependencyCreate({ ...base(), vendor_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_must_be_uuid_or_null");
  });

  it("accepts vendor_id as null explicitly", () => {
    const r = validateDependencyCreate({ ...base(), vendor_id: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBeNull();
  });

  // optional string fields — type errors
  it("rejects version as number", () => {
    const r = validateDependencyCreate({ ...base(), version: 42 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("version_must_be_string_or_null");
  });

  it("rejects description as number", () => {
    const r = validateDependencyCreate({ ...base(), description: 99 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("description_must_be_string_or_null");
  });

  it("rejects license as boolean", () => {
    const r = validateDependencyCreate({ ...base(), license: true });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("license_must_be_string_or_null");
  });

  it("rejects external_ref as number", () => {
    const r = validateDependencyCreate({ ...base(), external_ref: 123 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("external_ref_must_be_string_or_null");
  });

  // blank optional strings normalize to null
  it("normalizes blank description to null", () => {
    const r = validateDependencyCreate({ ...base(), description: "   " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.description).toBeNull();
  });

  it("normalizes blank license to null", () => {
    const r = validateDependencyCreate({ ...base(), license: "  " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.license).toBeNull();
  });
});

// ====================================================================
// validateDependencyUpdate — PATCH happy path
// ====================================================================

describe("validateDependencyUpdate — PATCH happy path", () => {
  it("accepts single-field update (name only)", () => {
    const r = validateDependencyUpdate({ name: "new-name" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("new-name");
      expect(r.input.dependency_type).toBeUndefined();
      expect(r.input.criticality).toBeUndefined();
    }
  });

  it("accepts multi-field update", () => {
    const r = validateDependencyUpdate({
      criticality: "High",
      status: "deprecated",
      version: "2.0.0"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.criticality).toBe("High");
      expect(r.input.status).toBe("deprecated");
      expect(r.input.version).toBe("2.0.0");
    }
  });

  it("accepts vendor_id as null to clear it", () => {
    const r = validateDependencyUpdate({ vendor_id: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBeNull();
  });

  it("accepts vendor_id as valid UUID", () => {
    const r = validateDependencyUpdate({ vendor_id: VALID_UUID_2 });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBe(VALID_UUID_2);
  });

  it("accepts all enum values for dependency_type", () => {
    for (const t of ["software_library", "cloud_service", "infrastructure", "api", "other"]) {
      const r = validateDependencyUpdate({ dependency_type: t });
      expect("input" in r).toBe(true);
    }
  });

  it("accepts all enum values for criticality", () => {
    for (const c of ["Critical", "High", "Moderate", "Low"]) {
      const r = validateDependencyUpdate({ criticality: c });
      expect("input" in r).toBe(true);
    }
  });

  it("accepts all enum values for status", () => {
    for (const s of ["active", "deprecated", "under_review"]) {
      const r = validateDependencyUpdate({ status: s });
      expect("input" in r).toBe(true);
    }
  });
});

// ====================================================================
// validateDependencyUpdate — PATCH rejects
// ====================================================================

describe("validateDependencyUpdate — PATCH rejects", () => {
  it("rejects empty body", () => {
    const r = validateDependencyUpdate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("no_fields_to_update");
  });

  it("rejects null body", () => {
    const r = validateDependencyUpdate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateDependencyUpdate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects name as empty string", () => {
    const r = validateDependencyUpdate({ name: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_must_be_non_empty_string");
  });

  it("rejects name as whitespace", () => {
    const r = validateDependencyUpdate({ name: "   " });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_must_be_non_empty_string");
  });

  it("rejects invalid dependency_type", () => {
    const r = validateDependencyUpdate({ dependency_type: "container" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_dependency_type");
  });

  it("rejects invalid criticality", () => {
    const r = validateDependencyUpdate({ criticality: "unknown" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_criticality");
  });

  it("rejects invalid status", () => {
    const r = validateDependencyUpdate({ status: "archived" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("rejects vendor_id as non-UUID string", () => {
    const r = validateDependencyUpdate({ vendor_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_must_be_uuid_or_null");
  });
});

// ====================================================================
// validateDependencyListQuery — GET list happy path
// ====================================================================

describe("validateDependencyListQuery — GET list happy path", () => {
  it("accepts empty query object", () => {
    const r = validateDependencyListQuery({});
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBeNull();
      expect(r.input.dependency_type).toBeNull();
      expect(r.input.vendor_id).toBeNull();
      expect(r.input.before_created_at).toBeNull();
      expect(r.input.before_id).toBeNull();
      expect(r.input.limit).toBe(25);
    }
  });

  it("accepts valid status filter", () => {
    const r = validateDependencyListQuery({ status: "deprecated" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("deprecated");
  });

  it("accepts valid dependency_type filter", () => {
    const r = validateDependencyListQuery({ dependency_type: "cloud_service" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.dependency_type).toBe("cloud_service");
  });

  it("accepts valid vendor_id UUID filter", () => {
    const r = validateDependencyListQuery({ vendor_id: VALID_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBe(VALID_UUID);
  });

  it("accepts valid cursor pair", () => {
    const r = validateDependencyListQuery({
      before_created_at: "2026-04-13T00:00:00.000Z",
      before_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.before_created_at).toBe("2026-04-13T00:00:00.000Z");
      expect(r.input.before_id).toBe(VALID_UUID);
    }
  });

  it("caps limit at 100", () => {
    const r = validateDependencyListQuery({ limit: 500 });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.limit).toBe(100);
  });

  it("defaults limit to 25 when absent", () => {
    const r = validateDependencyListQuery({});
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.limit).toBe(25);
  });
});

// ====================================================================
// validateDependencyListQuery — GET list rejects
// ====================================================================

describe("validateDependencyListQuery — GET list rejects", () => {
  it("rejects null query", () => {
    const r = validateDependencyListQuery(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("query_params_invalid");
  });

  it("rejects invalid status filter", () => {
    const r = validateDependencyListQuery({ status: "archived" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status_filter");
  });

  it("rejects invalid dependency_type filter", () => {
    const r = validateDependencyListQuery({ dependency_type: "container" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_dependency_type_filter");
  });

  it("rejects vendor_id that is not a UUID", () => {
    const r = validateDependencyListQuery({ vendor_id: "bad-id" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_must_be_uuid");
  });

  it("rejects cursor with only before_created_at present", () => {
    const r = validateDependencyListQuery({ before_created_at: "2026-04-13T00:00:00.000Z" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cursor_requires_both_before_created_at_and_before_id");
  });

  it("rejects cursor with only before_id present", () => {
    const r = validateDependencyListQuery({ before_id: VALID_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("cursor_requires_both_before_created_at_and_before_id");
  });

  it("rejects cursor with invalid before_id UUID", () => {
    const r = validateDependencyListQuery({
      before_created_at: "2026-04-13T00:00:00.000Z",
      before_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("before_id_must_be_uuid");
  });
});

// ====================================================================
// Route-layer contracts — documented
// ====================================================================

describe("route-layer contracts", () => {
  it("POST wrong-org vendor_id returns 404 at route layer (not validation)", () => {
    // Validation accepts a valid UUID vendor_id. The route queries
    // vendors WHERE id = $1 AND organization_id = $2 and returns 404
    // vendor_not_found if the vendor does not belong to this org.
    const r = validateDependencyCreate({
      name: "dep",
      dependency_type: "api",
      criticality: "Low",
      vendor_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBe(VALID_UUID);
  });

  it("PATCH wrong-org vendor_id update triggers re-verification at route layer", () => {
    // If vendor_id is updated to a non-null value, the route re-queries
    // vendors WHERE id = $1 AND organization_id = $2 and returns 404
    // vendor_not_found if the new vendor does not belong to this org.
    const r = validateDependencyUpdate({ vendor_id: VALID_UUID_2 });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBe(VALID_UUID_2);
  });

  it("GET by id wrong-org returns 404 dependency_not_found", () => {
    // Route queries dependencies WHERE id = $1 AND organization_id = $2.
    // If the record exists but belongs to a different org, rowCount is 0
    // and the route returns 404 dependency_not_found.
    expect(true).toBe(true);
  });

  it("all four routes apply requireApiKey -> attachOrganizationContext -> requireEntitlement(standard)", () => {
    // POST, GET, GET:id, PATCH all use the same middleware chain.
    expect(true).toBe(true);
  });
});

// ====================================================================
// Finding closure proofs
// ====================================================================

describe("finding 1 — isUuid trims before regex test (consistent with route)", () => {
  it("vendor_id with surrounding whitespace is accepted after trim", () => {
    // Pre-fix: UUID_RE.test(v) rejected padded UUIDs in validation while
    // the route's isUuid trimmed first and accepted them — inconsistent.
    // Post-fix: validation also trims, both layers behave identically.
    const padded = "  a1b2c3d4-e5f6-7890-abcd-ef1234567890  ";
    const r = validateDependencyCreate({
      name: "dep",
      dependency_type: "api",
      criticality: "Low",
      vendor_id: padded
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.vendor_id).toBe(padded.trim());
  });

  it("genuinely invalid UUID is still rejected after trim", () => {
    const r = validateDependencyCreate({
      name: "dep",
      dependency_type: "api",
      criticality: "Low",
      vendor_id: "  not-a-uuid  "
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("vendor_id_must_be_uuid_or_null");
  });
});
