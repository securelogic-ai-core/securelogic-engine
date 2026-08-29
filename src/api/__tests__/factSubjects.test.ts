/**
 * factSubjects.test.ts — the closed subject allowlist and the tenant-scoped
 * resolver (VA-Q2 P3; D1 Option B, integrity layer 3).
 */
import { describe, it, expect } from "vitest";
import {
  FACT_SUBJECT_TYPES,
  RESERVED_FACT_SUBJECT_TYPES,
  SUBJECT_RESOLVERS,
  isFactSubjectType,
  isReservedFactSubjectType,
  resolveFactSubject,
  subjectRef,
  type Queryable,
} from "../lib/vendorRisk/factSubjects.js";
import { canonicalJson, factValueHash } from "../lib/vendorRisk/factStore.js";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const ENG = "33333333-3333-4333-8333-333333333333";

/** A fake that returns a row regardless of the WHERE — so the org comparison in code is what is under test. */
function fakeDb(row: Record<string, unknown> | null): Queryable & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    query: (async (_text: string, params?: unknown[]) => {
      calls.push(params ?? []);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }) as unknown as Queryable["query"],
  };
}

describe("fact subjects — closed allowlist", () => {
  it("vendor_engagement is the only active type; the four reserved types are named and refused", () => {
    expect(FACT_SUBJECT_TYPES).toEqual(["vendor_engagement"]);
    expect([...RESERVED_FACT_SUBJECT_TYPES].sort()).toEqual(["ai_system", "asset", "organization", "vendor"]);
    for (const t of RESERVED_FACT_SUBJECT_TYPES) {
      expect(isFactSubjectType(t), t).toBe(false);
      expect(isReservedFactSubjectType(t), t).toBe(true);
    }
    expect(Object.keys(SUBJECT_RESOLVERS)).toEqual([...FACT_SUBJECT_TYPES]);
  });

  it("a reserved or unknown type never reaches the database", async () => {
    const db = fakeDb({ id: ENG, organization_id: ORG_A, vendor_id: "v", status: "draft", scope_rule_version: "1.1.0", updated_at: new Date() });
    for (const t of [...RESERVED_FACT_SUBJECT_TYPES, "bogus", "", 1, null, undefined]) {
      expect(await resolveFactSubject(db, ORG_A, t, ENG), String(t)).toBeNull();
    }
    expect(db.calls).toEqual([]);
  });
});

describe("fact subjects — the resolver compares organization_id (belt-and-braces over RLS)", () => {
  const loaded = { id: ENG, organization_id: ORG_B, vendor_id: "v", status: "scoped", scope_rule_version: "1.1.0", updated_at: new Date("2026-08-01T00:00:00Z") };

  it("org mismatch → null even when the row is loaded", async () => {
    expect(await resolveFactSubject(fakeDb(loaded), ORG_A, "vendor_engagement", ENG)).toBeNull();
  });

  it("the query itself is scoped by BOTH id and organization_id", async () => {
    const db = fakeDb(null);
    await resolveFactSubject(db, ORG_A, "vendor_engagement", ENG);
    expect(db.calls).toEqual([[ENG, ORG_A]]);
  });

  it("a malformed id short-circuits without a query", async () => {
    const db = fakeDb(loaded);
    expect(await resolveFactSubject(db, ORG_A, "vendor_engagement", "not-a-uuid")).toBeNull();
    expect(await resolveFactSubject(db, "nope", "vendor_engagement", ENG)).toBeNull();
    expect(await resolveFactSubject(db, ORG_A, "vendor_engagement", 42)).toBeNull();
    expect(db.calls).toEqual([]);
  });

  it("a matching row becomes a typed subject with the state the freeze guard reads", async () => {
    const s = await resolveFactSubject(fakeDb({ ...loaded, organization_id: ORG_B }), ORG_B, "vendor_engagement", ENG);
    expect(s).toMatchObject({ kind: "vendor_engagement", id: ENG, organization_id: ORG_B, vendor_id: "v", state: "scoped", scope_rule_version: "1.1.0" });
    expect(subjectRef(s!)).toEqual({ subject_type: "vendor_engagement", subject_id: ENG });
    const legacy = await resolveFactSubject(fakeDb({ ...loaded, scope_rule_version: null }), ORG_B, "vendor_engagement", ENG);
    expect(legacy?.scope_rule_version).toBe("1.0.0");
  });
});

describe("fact store — canonical value hash", () => {
  it("is stable across key order and nesting, and distinguishes different values", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
    expect(factValueHash({ b: 1, a: 2 })).toBe(factValueHash({ a: 2, b: 1 }));
    expect(factValueHash(["DE", "US"])).not.toBe(factValueHash(["US", "DE"])); // lists are ordered values
    expect(factValueHash(true)).not.toBe(factValueHash("true"));
    expect(factValueHash(true)).toMatch(/^[0-9a-f]{64}$/);
  });
});
