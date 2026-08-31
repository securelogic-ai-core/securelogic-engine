/**
 * tenantClass.test.ts — VA-S4-4C-3, owner decision 6.
 *
 * Synthetic validation evidence must be distinguishable from real customer
 * evidence and must not accidentally enter real-corpus measurements, customer
 * assurance metrics, product analytics, prevalence claims, or production
 * evidence reasoning.
 *
 * The required proof is that synthetic fixture data CANNOT MASQUERADE AS REAL
 * CORPUS under the chosen mechanism. These are the pure-layer halves of that;
 * the database halves live in test/isolation/assuranceOutcomeAuthority.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  TENANT_CLASSES,
  isTenantClass,
  classifyForMeasurement,
  isRealCorpus,
  realCorpusOrgPredicate,
  realCorpusOrgIdPredicate,
  assertSqlIdentifier,
} from "../lib/tenantClass.js";

describe("the classification vocabulary", () => {
  it("is exactly two values", () => {
    expect(TENANT_CLASSES).toEqual(["customer", "synthetic_fixture"]);
  });

  it("recognises only those two", () => {
    expect(isTenantClass("customer")).toBe(true);
    expect(isTenantClass("synthetic_fixture")).toBe(true);
    for (const bad of ["demo", "test", "", null, undefined, 1, {}]) {
      expect(isTenantClass(bad)).toBe(false);
    }
  });
});

describe("synthetic data cannot masquerade as real corpus", () => {
  it("an explicitly synthetic tenant is never real corpus", () => {
    expect(isRealCorpus("synthetic_fixture")).toBe(false);
  });

  it("ONLY the literal value 'customer' is real corpus", () => {
    expect(isRealCorpus("customer")).toBe(true);
  });

  it("an UNKNOWN classification resolves to synthetic, not to real", () => {
    // The fail-closed direction FOR MEASUREMENT, and deliberately the opposite
    // of the column's DEFAULT. A value this code cannot recognise does not get
    // to back a claim about the world.
    for (const unknown of [null, undefined, "", "demo", "Customer", "CUSTOMER", "internal", "unknown"]) {
      expect(classifyForMeasurement(unknown)).toBe("synthetic_fixture");
      expect(isRealCorpus(unknown)).toBe(false);
    }
  });

  it("a future third class does not silently become real corpus", () => {
    // Adding a value to the CHECK without revisiting the measurement rule must
    // keep it OUT of prevalence claims until someone decides otherwise.
    expect(isRealCorpus("demo_tenant")).toBe(false);
  });
});

describe("the predicate is the only sanctioned way to ask", () => {
  it("emits a filter on the column, not a list of excluded ids", () => {
    const sql = realCorpusOrgPredicate("o");
    expect(sql).toBe("o.tenant_class = 'customer'");
    // The mechanism the owner ruled out: no literal organization id anywhere.
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("never names the retained synthetic fixture organization by id", () => {
    expect(realCorpusOrgPredicate()).not.toContain("b1a3da2d");
    expect(realCorpusOrgIdPredicate("t.organization_id")).not.toContain("b1a3da2d");
  });

  it("the org-id form emits a subquery rather than tempting an inline id list", () => {
    expect(realCorpusOrgIdPredicate("t.organization_id")).toBe(
      "t.organization_id IN (SELECT id FROM organizations WHERE tenant_class = 'customer')"
    );
  });

  it("refuses anything that is not a bare SQL identifier", () => {
    // The alias is interpolated, so this check is what makes it safe.
    for (const hostile of ["o; DROP TABLE organizations --", "o'", "1=1", "", "o o", "o.*"]) {
      expect(() => realCorpusOrgPredicate(hostile)).toThrow(/bare SQL identifier/);
    }
    expect(() => assertSqlIdentifier("organizations")).not.toThrow();
    expect(() => assertSqlIdentifier("_o1")).not.toThrow();
  });

  it("accepts a dotted column reference by validating each part", () => {
    expect(() => realCorpusOrgIdPredicate("va.organization_id")).not.toThrow();
    expect(() => realCorpusOrgIdPredicate("va.organization_id; DROP")).toThrow();
  });
});
