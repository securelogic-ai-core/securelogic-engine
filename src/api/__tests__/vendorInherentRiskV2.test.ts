/**
 * vendorInherentRiskV2.test.ts — inherent risk v2: exposure only.
 */
import { describe, it, expect } from "vitest";
import {
  computeVendorInherentRiskV2,
  INHERENT_V2_WEIGHTS,
  INHERENT_V2_DIMENSIONS,
  INHERENT_V2_ESCALATION_RULES,
  type InherentRiskV2Input,
} from "../lib/vendorRisk/inherentRiskV2.js";
import { computeVendorInherentRisk, DIMENSION_WEIGHTS } from "../lib/vendorRisk/inherentRisk.js";

const base: InherentRiskV2Input = {
  data_sensitivity: "none",
  data_volume: "minimal",
  access_level: "none",
  regulatory_exposure: "none",
  regulatory_breach_notification: false,
  ai_involvement: "none",
  ai_autonomy: "none",
  hosting_model: "on_prem",
  fourth_party_exposure: "none",
};
const v = (o: Partial<InherentRiskV2Input>): InherentRiskV2Input => ({ ...base, ...o });

describe("inherent risk v2 — structural invariants", () => {
  it("weights sum to 1 within float epsilon — the rationals are exact, IEEE-754 is not", () => {
    // 20/70 + 18/70 + 12/70 + 9/70 + 6/70 + 5/70 = 70/70 exactly in arithmetic;
    // as doubles the sum lands at 0.9999999999999999. Assert far tighter than
    // v1's 1e-9 so a real drift (a hand-edited decimal) still fails.
    const sum = Object.values(INHERENT_V2_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-12);
    // And the numerators really are the v1 weights over 70.
    expect(INHERENT_V2_WEIGHTS.data_exposure * 70).toBeCloseTo(20, 12);
    expect(INHERENT_V2_WEIGHTS.fourth_party_exposure * 70).toBeCloseTo(5, 12);
  });
  it("each v2 weight is the v1 weight divided by 0.70 — relative proportions preserved", () => {
    for (const d of INHERENT_V2_DIMENSIONS) {
      expect(INHERENT_V2_WEIGHTS[d]).toBeCloseTo(DIMENSION_WEIGHTS[d] / 0.7, 12);
    }
  });
  it("the removed dimensions are GONE (M1/M3): no business-dependency concept remains", () => {
    const dims = [...INHERENT_V2_DIMENSIONS];
    for (const gone of ["business_criticality", "operational_dependency", "concentration"]) expect(dims).not.toContain(gone);
    const keys = Object.keys(base);
    for (const gone of ["business_criticality", "operational_dependency", "recoverability", "concentration"]) expect(keys).not.toContain(gone);
  });
  it("E1b and E4 are NOT here — they moved to the tier methodology (M2)", () => {
    const ids = INHERENT_V2_ESCALATION_RULES.map((r) => r.rule_id).sort();
    expect(ids).toEqual(["E1", "E2", "E3"]);
  });
  it("emits NO tier", () => {
    expect((computeVendorInherentRiskV2(base) as Record<string, unknown>).tier).toBeUndefined();
  });
  it("is deterministic and stamps its own version", () => {
    const i = v({ data_sensitivity: "restricted", access_level: "admin" });
    expect(JSON.stringify(computeVendorInherentRiskV2(i))).toBe(JSON.stringify(computeVendorInherentRiskV2(i)));
    expect(computeVendorInherentRiskV2(i).basis.method).toBe("vendor_inherent_v2");
    expect(computeVendorInherentRiskV2(i).basis.methodology_version).toBe("2.0.0");
  });
  it("v1 is untouched and still reproduces (historical engagements are never rescored)", () => {
    const r = computeVendorInherentRisk({
      ...base,
      operational_dependency: "low",
      recoverability: "hours",
      business_criticality: "low",
      concentration: "none",
    });
    expect(r.basis.method).toBe("vendor_inherent_v1");
    expect(r.basis.methodology_version).toBe("1.0.0");
    expect(r.basis.factors).toHaveLength(9);
  });
});

describe("inherent risk v2 — level parity with v1 for the surviving dimensions", () => {
  it("scores each surviving dimension's raw value identically to v1", () => {
    // Same facts through both engines; compare the per-dimension RAW score,
    // which is weight-independent.
    const facts = v({ data_sensitivity: "confidential", data_volume: "large", access_level: "read_write", regulatory_exposure: "moderate", ai_involvement: "embedded", ai_autonomy: "human_in_the_loop", hosting_model: "multi_tenant_saas", fourth_party_exposure: "low" });
    const v2 = computeVendorInherentRiskV2(facts);
    const v1 = computeVendorInherentRisk({ ...facts, operational_dependency: "low", recoverability: "hours", business_criticality: "low", concentration: "none" });
    for (const d of INHERENT_V2_DIMENSIONS) {
      const a = v2.basis.factors.find((f) => f.dimension === d)!.raw;
      const b = v1.basis.factors.find((f) => f.dimension === d)!.raw;
      expect(a).toBe(b);
    }
  });
});

describe("inherent risk v2 — floors", () => {
  it("E1: restricted + admin floors to High", () => {
    const r = computeVendorInherentRiskV2(v({ data_sensitivity: "restricted", access_level: "admin", data_volume: "minimal" }));
    expect(r.band).toBe("High");
    expect(r.basis.adjustments.map((a) => a.rule_id)).toContain("E1");
  });
  it("E2: autonomous consequential AI floors to High", () => {
    const r = computeVendorInherentRiskV2(v({ ai_involvement: "embedded", ai_autonomy: "autonomous_consequential" }));
    expect(r.band).toBe("High");
  });
  it("E3: breach-notification duty on confidential data floors to High", () => {
    const r = computeVendorInherentRiskV2(v({ data_sensitivity: "confidential", regulatory_breach_notification: true }));
    expect(r.band).toBe("High");
  });
});

describe("inherent risk v2 — owner-approved drift table (same facts, v1 vs v2)", () => {
  it("Cloud infrastructure: v1 78 Critical → v2 68 High (dependency weight moved to criticality)", () => {
    const f = v({ data_sensitivity: "confidential", data_volume: "mass", access_level: "network_access", regulatory_exposure: "moderate", hosting_model: "multi_tenant_saas", fourth_party_exposure: "moderate" });
    expect(computeVendorInherentRiskV2(f).score).toBe(68);
    expect(computeVendorInherentRiskV2(f).band).toBe("High");
  });
  it("Clinical AI transcription: v1 70 High → v2 84 Critical (exposure-heavy rises)", () => {
    const f = v({ data_sensitivity: "restricted", data_volume: "large", access_level: "read_write", regulatory_exposure: "high", ai_involvement: "core", ai_autonomy: "human_on_the_loop", hosting_model: "multi_tenant_saas", fourth_party_exposure: "moderate" });
    expect(computeVendorInherentRiskV2(f).score).toBe(84);
    expect(computeVendorInherentRiskV2(f).band).toBe("Critical");
  });
  it("Niche logistics: v2 30 Moderate", () => {
    const f = v({ data_sensitivity: "internal", data_volume: "moderate", access_level: "read_only", regulatory_exposure: "low", hosting_model: "saas", fourth_party_exposure: "moderate" });
    expect(computeVendorInherentRiskV2(f).score).toBe(30);
  });
  it("Office catering: 5 Low", () => {
    expect(computeVendorInherentRiskV2(v({ hosting_model: "saas" })).score).toBe(5);
  });
});
