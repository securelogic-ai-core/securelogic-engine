/**
 * enterpriseRelationships.test.ts — unit tests for the ECL Slice 2 validator.
 * DB-free. Cross-org / RLS + two-endpoint pre-flight behavior is proven in
 * test/isolation/enterpriseRelationshipsRls.test.ts.
 */

import { describe, expect, it } from "vitest";
import { validateEnterpriseRelationshipCreate } from "../lib/enterpriseRelationshipValidation.js";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("validateEnterpriseRelationshipCreate", () => {
  it("accepts a valid edge", () => {
    const r = validateEnterpriseRelationshipCreate({
      from_type: "application",
      // application is NOT a node type — must fail; corrected below
      from_id: A,
      to_type: "vendor",
      to_id: B,
      relationship_type: "depends_on"
    });
    // 'application' is an entity_type, not a node_type → invalid from_type
    expect(r).toMatchObject({ error: "from_type_invalid" });

    const ok = validateEnterpriseRelationshipCreate({
      from_type: "enterprise_entity",
      from_id: A,
      to_type: "vendor",
      to_id: B,
      relationship_type: "depends_on",
      note: "app depends on this SaaS vendor"
    });
    expect("input" in ok).toBe(true);
    if ("input" in ok) {
      expect(ok.input.from_type).toBe("enterprise_entity");
      expect(ok.input.to_type).toBe("vendor");
      expect(ok.input.relationship_type).toBe("depends_on");
      expect(ok.input.note).toContain("SaaS vendor");
    }
  });

  it("rejects a non-object body", () => {
    expect(validateEnterpriseRelationshipCreate(null)).toEqual({ error: "request_body_must_be_object" });
  });

  it("rejects invalid node types and relationship type", () => {
    const base = { from_id: A, to_id: B, relationship_type: "depends_on" };
    expect(validateEnterpriseRelationshipCreate({ ...base, from_type: "nope", to_type: "vendor" })).toMatchObject({ error: "from_type_invalid" });
    expect(validateEnterpriseRelationshipCreate({ ...base, from_type: "vendor", to_type: "nope" })).toMatchObject({ error: "to_type_invalid" });
    expect(
      validateEnterpriseRelationshipCreate({ from_type: "vendor", from_id: A, to_type: "user", to_id: B, relationship_type: "loves" })
    ).toMatchObject({ error: "relationship_type_invalid" });
  });

  it("rejects malformed endpoint ids", () => {
    expect(
      validateEnterpriseRelationshipCreate({ from_type: "vendor", from_id: "bad", to_type: "user", to_id: B, relationship_type: "owned_by" })
    ).toEqual({ error: "from_id_invalid" });
    expect(
      validateEnterpriseRelationshipCreate({ from_type: "vendor", from_id: A, to_type: "user", to_id: "bad", relationship_type: "owned_by" })
    ).toEqual({ error: "to_id_invalid" });
  });

  it("rejects a self-edge (same type AND same id)", () => {
    expect(
      validateEnterpriseRelationshipCreate({ from_type: "vendor", from_id: A, to_type: "vendor", to_id: A, relationship_type: "depends_on" })
    ).toEqual({ error: "self_edge_not_allowed" });
    // same id but different type is allowed (different nodes)
    const ok = validateEnterpriseRelationshipCreate({ from_type: "vendor", from_id: A, to_type: "ai_system", to_id: A, relationship_type: "depends_on" });
    expect("input" in ok).toBe(true);
  });

  it("bounds the note", () => {
    expect(
      validateEnterpriseRelationshipCreate({ from_type: "vendor", from_id: A, to_type: "user", to_id: B, relationship_type: "owned_by", note: "x".repeat(501) })
    ).toMatchObject({ error: "note_too_long" });
    expect(
      validateEnterpriseRelationshipCreate({ from_type: "vendor", from_id: A, to_type: "user", to_id: B, relationship_type: "owned_by", note: 5 })
    ).toEqual({ error: "note_must_be_string" });
  });
});
