import { describe, it, expect } from "vitest";
import { validateFrameworkCreate } from "../lib/frameworkValidation.js";
import { validateRequirementCreate } from "../lib/requirementValidation.js";
import { validateControlCreate } from "../lib/controlValidation.js";
import { validateControlMappingCreate } from "../lib/controlMappingValidation.js";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_UUID_2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ================================================================
// validateFrameworkCreate
// ================================================================

describe("validateFrameworkCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateFrameworkCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateFrameworkCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateFrameworkCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

describe("validateFrameworkCreate — name", () => {
  it("rejects missing name", () => {
    const r = validateFrameworkCreate({ version: "2.0" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects empty name", () => {
    const r = validateFrameworkCreate({ name: "   ", version: "2.0" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects numeric name", () => {
    const r = validateFrameworkCreate({ name: 42, version: "2.0" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("accepts name and trims it", () => {
    const r = validateFrameworkCreate({ name: "  NIST CSF  ", version: "2.0" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.name).toBe("NIST CSF");
  });
});

describe("validateFrameworkCreate — version", () => {
  it("rejects missing version", () => {
    const r = validateFrameworkCreate({ name: "NIST CSF" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("version_required");
  });

  it("rejects empty version", () => {
    const r = validateFrameworkCreate({ name: "NIST CSF", version: "   " });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("version_required");
  });

  it("rejects numeric version", () => {
    const r = validateFrameworkCreate({ name: "NIST CSF", version: 2 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("version_required");
  });

  it("accepts version and trims it", () => {
    const r = validateFrameworkCreate({ name: "NIST CSF", version: "  2.0  " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.version).toBe("2.0");
  });
});

describe("validateFrameworkCreate — valid input", () => {
  it("returns input for minimal valid body", () => {
    const r = validateFrameworkCreate({ name: "ISO 27001", version: "2022" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("ISO 27001");
      expect(r.input.version).toBe("2022");
    }
  });

  it("ignores extra fields", () => {
    const r = validateFrameworkCreate({
      name: "SOC 2",
      version: "Type II",
      extra: "ignored"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("SOC 2");
      expect(r.input.version).toBe("Type II");
    }
  });
});

// ================================================================
// validateRequirementCreate
// ================================================================

describe("validateRequirementCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateRequirementCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateRequirementCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateRequirementCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

describe("validateRequirementCreate — framework_id", () => {
  it("rejects missing framework_id", () => {
    const r = validateRequirementCreate({
      reference_id: "ID.AM-1",
      title: "Asset inventory"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("framework_id_required");
  });

  it("rejects empty framework_id", () => {
    const r = validateRequirementCreate({
      framework_id: "   ",
      reference_id: "ID.AM-1",
      title: "Asset inventory"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("framework_id_required");
  });

  it("rejects non-UUID framework_id", () => {
    const r = validateRequirementCreate({
      framework_id: "not-a-uuid",
      reference_id: "ID.AM-1",
      title: "Asset inventory"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("framework_id_must_be_uuid");
  });

  it("accepts valid UUID framework_id", () => {
    const r = validateRequirementCreate({
      framework_id: VALID_UUID,
      reference_id: "ID.AM-1",
      title: "Asset inventory"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.framework_id).toBe(VALID_UUID);
  });
});

describe("validateRequirementCreate — reference_id", () => {
  it("rejects missing reference_id", () => {
    const r = validateRequirementCreate({
      framework_id: VALID_UUID,
      title: "Asset inventory"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reference_id_required");
  });

  it("rejects empty reference_id", () => {
    const r = validateRequirementCreate({
      framework_id: VALID_UUID,
      reference_id: "   ",
      title: "Asset inventory"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("reference_id_required");
  });

  it("accepts reference_id and trims it", () => {
    const r = validateRequirementCreate({
      framework_id: VALID_UUID,
      reference_id: "  ID.AM-1  ",
      title: "Asset inventory"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.reference_id).toBe("ID.AM-1");
  });
});

describe("validateRequirementCreate — title", () => {
  it("rejects missing title", () => {
    const r = validateRequirementCreate({
      framework_id: VALID_UUID,
      reference_id: "ID.AM-1"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("rejects empty title", () => {
    const r = validateRequirementCreate({
      framework_id: VALID_UUID,
      reference_id: "ID.AM-1",
      title: "   "
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("accepts title and trims it", () => {
    const r = validateRequirementCreate({
      framework_id: VALID_UUID,
      reference_id: "ID.AM-1",
      title: "  Asset inventory is maintained  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.title).toBe("Asset inventory is maintained");
  });
});

describe("validateRequirementCreate — valid input", () => {
  it("returns all fields for valid body", () => {
    const r = validateRequirementCreate({
      framework_id: VALID_UUID,
      reference_id: "ID.AM-1",
      title: "Asset inventory is maintained"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.framework_id).toBe(VALID_UUID);
      expect(r.input.reference_id).toBe("ID.AM-1");
      expect(r.input.title).toBe("Asset inventory is maintained");
    }
  });
});

// ================================================================
// validateControlCreate
// ================================================================

describe("validateControlCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateControlCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateControlCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateControlCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

describe("validateControlCreate — name", () => {
  it("rejects missing name", () => {
    const r = validateControlCreate({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects empty name", () => {
    const r = validateControlCreate({ name: "   " });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects numeric name", () => {
    const r = validateControlCreate({ name: 99 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("accepts name and trims it", () => {
    const r = validateControlCreate({ name: "  Access Review Policy  " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.name).toBe("Access Review Policy");
  });
});

describe("validateControlCreate — description", () => {
  it("defaults description to null when absent", () => {
    const r = validateControlCreate({ name: "Control A" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.description).toBeNull();
  });

  it("accepts null description", () => {
    const r = validateControlCreate({ name: "Control A", description: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.description).toBeNull();
  });

  it("rejects non-string non-null description", () => {
    const r = validateControlCreate({ name: "Control A", description: 42 });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("description_must_be_string_or_null");
  });

  it("accepts description string and trims it", () => {
    const r = validateControlCreate({
      name: "Control A",
      description: "  Quarterly access review  "
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.description).toBe("Quarterly access review");
  });

  it("treats whitespace-only description as null", () => {
    const r = validateControlCreate({ name: "Control A", description: "   " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.description).toBeNull();
  });
});

describe("validateControlCreate — owner_user_id", () => {
  it("defaults owner_user_id to null when absent", () => {
    const r = validateControlCreate({ name: "Control A" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBeNull();
  });

  it("accepts null owner_user_id", () => {
    const r = validateControlCreate({ name: "Control A", owner_user_id: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBeNull();
  });

  it("rejects non-UUID owner_user_id", () => {
    const r = validateControlCreate({
      name: "Control A",
      owner_user_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("owner_user_id_must_be_uuid_or_null");
  });

  it("accepts valid UUID owner_user_id", () => {
    const r = validateControlCreate({
      name: "Control A",
      owner_user_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBe(VALID_UUID);
  });
});

describe("validateControlCreate — valid input", () => {
  it("returns all fields for minimal valid body", () => {
    const r = validateControlCreate({ name: "MFA Enforcement" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("MFA Enforcement");
      expect(r.input.description).toBeNull();
      expect(r.input.owner_user_id).toBeNull();
    }
  });

  it("returns all fields for fully-specified body", () => {
    const r = validateControlCreate({
      name: "MFA Enforcement",
      description: "All admin accounts require MFA.",
      owner_user_id: VALID_UUID
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("MFA Enforcement");
      expect(r.input.description).toBe("All admin accounts require MFA.");
      expect(r.input.owner_user_id).toBe(VALID_UUID);
    }
  });
});

// ================================================================
// validateControlMappingCreate
// ================================================================

describe("validateControlMappingCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateControlMappingCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateControlMappingCreate("hello");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateControlMappingCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

describe("validateControlMappingCreate — control_id", () => {
  it("rejects missing control_id", () => {
    const r = validateControlMappingCreate({ requirement_id: VALID_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_required");
  });

  it("rejects empty control_id", () => {
    const r = validateControlMappingCreate({
      control_id: "   ",
      requirement_id: VALID_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_required");
  });

  it("rejects non-UUID control_id", () => {
    const r = validateControlMappingCreate({
      control_id: "not-a-uuid",
      requirement_id: VALID_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("control_id_must_be_uuid");
  });

  it("accepts valid UUID control_id", () => {
    const r = validateControlMappingCreate({
      control_id: VALID_UUID,
      requirement_id: VALID_UUID_2
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.control_id).toBe(VALID_UUID);
  });
});

describe("validateControlMappingCreate — requirement_id", () => {
  it("rejects missing requirement_id", () => {
    const r = validateControlMappingCreate({ control_id: VALID_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("requirement_id_required");
  });

  it("rejects empty requirement_id", () => {
    const r = validateControlMappingCreate({
      control_id: VALID_UUID,
      requirement_id: "   "
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("requirement_id_required");
  });

  it("rejects non-UUID requirement_id", () => {
    const r = validateControlMappingCreate({
      control_id: VALID_UUID,
      requirement_id: "not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("requirement_id_must_be_uuid");
  });

  it("accepts valid UUID requirement_id", () => {
    const r = validateControlMappingCreate({
      control_id: VALID_UUID,
      requirement_id: VALID_UUID_2
    });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.requirement_id).toBe(VALID_UUID_2);
  });
});

describe("validateControlMappingCreate — valid input", () => {
  it("returns both IDs for valid body", () => {
    const r = validateControlMappingCreate({
      control_id: VALID_UUID,
      requirement_id: VALID_UUID_2
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.control_id).toBe(VALID_UUID);
      expect(r.input.requirement_id).toBe(VALID_UUID_2);
    }
  });

  it("ignores extra fields", () => {
    const r = validateControlMappingCreate({
      control_id: VALID_UUID,
      requirement_id: VALID_UUID_2,
      extra: "ignored"
    });
    expect("input" in r).toBe(true);
  });
});
