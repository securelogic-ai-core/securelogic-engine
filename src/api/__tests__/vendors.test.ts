import { describe, it, expect } from "vitest";
import {
  validateVendorCreate,
  validateVendorPatch
} from "../lib/vendorValidation.js";

// ----------------------------------------------------------------
// validateVendorCreate
// ----------------------------------------------------------------

describe("validateVendorCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateVendorCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects non-object body (string)", () => {
    const r = validateVendorCreate("Acme Corp");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateVendorCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

describe("validateVendorCreate — required fields", () => {
  it("rejects missing name", () => {
    const r = validateVendorCreate({ criticality: "high" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects empty name", () => {
    const r = validateVendorCreate({ name: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });

  it("rejects whitespace-only name", () => {
    const r = validateVendorCreate({ name: "   " });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_required");
  });
});

describe("validateVendorCreate — criticality", () => {
  it("rejects invalid criticality", () => {
    const r = validateVendorCreate({ name: "Acme", criticality: "extreme" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_criticality");
  });

  it("accepts criticality=critical", () => {
    const r = validateVendorCreate({ name: "Acme", criticality: "critical" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBe("critical");
  });

  it("accepts criticality=high", () => {
    const r = validateVendorCreate({ name: "Acme", criticality: "high" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBe("high");
  });

  it("accepts criticality=medium", () => {
    const r = validateVendorCreate({ name: "Acme", criticality: "medium" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBe("medium");
  });

  it("accepts criticality=low", () => {
    const r = validateVendorCreate({ name: "Acme", criticality: "low" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBe("low");
  });

  it("omits criticality when not provided (null)", () => {
    const r = validateVendorCreate({ name: "Acme" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBeNull();
  });
});

describe("validateVendorCreate — data_sensitivity", () => {
  it("rejects invalid data_sensitivity", () => {
    const r = validateVendorCreate({ name: "Acme", data_sensitivity: "secret" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_data_sensitivity");
  });

  it("accepts data_sensitivity=none", () => {
    const r = validateVendorCreate({ name: "Acme", data_sensitivity: "none" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.data_sensitivity).toBe("none");
  });

  it("accepts data_sensitivity=confidential", () => {
    const r = validateVendorCreate({ name: "Acme", data_sensitivity: "confidential" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.data_sensitivity).toBe("confidential");
  });

  it("accepts data_sensitivity=restricted", () => {
    const r = validateVendorCreate({ name: "Acme", data_sensitivity: "restricted" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.data_sensitivity).toBe("restricted");
  });
});

describe("validateVendorCreate — access_level", () => {
  it("rejects invalid access_level", () => {
    const r = validateVendorCreate({ name: "Acme", access_level: "superuser" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_access_level");
  });

  it("accepts all valid access_level values", () => {
    const levels = ["none", "read_only", "read_write", "admin", "network_access"];
    for (const level of levels) {
      const r = validateVendorCreate({ name: "Acme", access_level: level });
      expect("input" in r).toBe(true);
      if ("input" in r) expect(r.input.access_level).toBe(level);
    }
  });
});

describe("validateVendorCreate — owner_user_id", () => {
  it("rejects non-UUID owner_user_id", () => {
    const r = validateVendorCreate({ name: "Acme", owner_user_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("owner_user_id_must_be_uuid");
  });

  it("accepts valid UUID owner_user_id", () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const r = validateVendorCreate({ name: "Acme", owner_user_id: uuid });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBe(uuid);
  });

  it("accepts null owner_user_id", () => {
    const r = validateVendorCreate({ name: "Acme", owner_user_id: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBeNull();
  });
});

describe("validateVendorCreate — minimal valid body", () => {
  it("accepts name only", () => {
    const r = validateVendorCreate({ name: "Acme Corp" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("Acme Corp");
      expect(r.input.criticality).toBeNull();
      expect(r.input.data_sensitivity).toBeNull();
      expect(r.input.access_level).toBeNull();
      expect(r.input.service_description).toBeNull();
      expect(r.input.category).toBeNull();
      expect(r.input.website).toBeNull();
      expect(r.input.owner_user_id).toBeNull();
    }
  });

  it("trims name whitespace", () => {
    const r = validateVendorCreate({ name: "  Acme Corp  " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.name).toBe("Acme Corp");
  });
});

describe("validateVendorCreate — full valid body", () => {
  it("accepts all fields populated", () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const r = validateVendorCreate({
      name: "Acme Corp",
      service_description: "Cloud infrastructure provider",
      category: "Infrastructure",
      criticality: "critical",
      data_sensitivity: "restricted",
      access_level: "admin",
      website: "https://acme.example.com",
      owner_user_id: uuid
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("Acme Corp");
      expect(r.input.service_description).toBe("Cloud infrastructure provider");
      expect(r.input.category).toBe("Infrastructure");
      expect(r.input.criticality).toBe("critical");
      expect(r.input.data_sensitivity).toBe("restricted");
      expect(r.input.access_level).toBe("admin");
      expect(r.input.website).toBe("https://acme.example.com");
      expect(r.input.owner_user_id).toBe(uuid);
    }
  });
});

// ----------------------------------------------------------------
// validateVendorPatch
// ----------------------------------------------------------------

describe("validateVendorPatch — body shape", () => {
  it("rejects null body", () => {
    const r = validateVendorPatch(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects non-object body", () => {
    const r = validateVendorPatch("update me");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects empty object (no updateable fields)", () => {
    const r = validateVendorPatch({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("no_updateable_fields");
  });
});

describe("validateVendorPatch — name", () => {
  it("rejects empty name", () => {
    const r = validateVendorPatch({ name: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_must_be_non_empty_string");
  });

  it("rejects whitespace-only name", () => {
    const r = validateVendorPatch({ name: "   " });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("name_must_be_non_empty_string");
  });

  it("accepts a valid name and trims it", () => {
    const r = validateVendorPatch({ name: "  New Name  " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.name).toBe("New Name");
  });
});

describe("validateVendorPatch — status", () => {
  it("rejects invalid status", () => {
    const r = validateVendorPatch({ status: "deleted" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("rejects status=open (findings enum, not vendor)", () => {
    const r = validateVendorPatch({ status: "open" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts status=archived", () => {
    const r = validateVendorPatch({ status: "archived" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("archived");
  });

  it("accepts status=active", () => {
    const r = validateVendorPatch({ status: "active" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("active");
  });
});

describe("validateVendorPatch — criticality", () => {
  it("rejects invalid criticality", () => {
    const r = validateVendorPatch({ criticality: "severe" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_criticality");
  });

  it("accepts null criticality (unset)", () => {
    const r = validateVendorPatch({ criticality: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBeNull();
  });

  it("accepts criticality=high", () => {
    const r = validateVendorPatch({ criticality: "high" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.criticality).toBe("high");
  });
});

describe("validateVendorPatch — owner_user_id", () => {
  it("rejects non-UUID owner_user_id", () => {
    const r = validateVendorPatch({ owner_user_id: "bad-id" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("owner_user_id_must_be_uuid_or_null");
  });

  it("accepts null owner_user_id (unassign)", () => {
    const r = validateVendorPatch({ owner_user_id: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBeNull();
  });

  it("accepts valid UUID owner_user_id", () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const r = validateVendorPatch({ owner_user_id: uuid });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBe(uuid);
  });
});

describe("validateVendorPatch — single field patches", () => {
  it("accepts name-only patch", () => {
    const r = validateVendorPatch({ name: "Updated Name" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.name).toBe("Updated Name");
      expect(Object.keys(r.input)).toHaveLength(1);
    }
  });

  it("accepts service_description-only patch", () => {
    const r = validateVendorPatch({ service_description: "New description" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.service_description).toBe("New description");
  });

  it("accepts access_level-only patch to network_access", () => {
    const r = validateVendorPatch({ access_level: "network_access" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.access_level).toBe("network_access");
  });

  it("accepts data_sensitivity set to null (unset)", () => {
    const r = validateVendorPatch({ data_sensitivity: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.data_sensitivity).toBeNull();
  });
});
