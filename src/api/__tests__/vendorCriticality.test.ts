/**
 * vendorCriticality.test.ts — the deterministic criticality model.
 *
 * These are the invariants the frozen Onboarding 2.0 methodology turns on. The
 * scenario table is the owner-approved one; a change that moves any of its
 * BANDS is a methodology change and must be a version bump, not a patch.
 */
import { describe, it, expect } from "vitest";
import {
  computeVendorCriticality,
  CRITICALITY_WEIGHTS,
  CRITICALITY_DIMENSIONS,
  CRITICALITY_ESCALATION_RULES,
  type CriticalityInput,
} from "../lib/vendorRisk/criticality.js";
import { BAND_MIN_SCORE } from "../lib/vendorRisk/riskBands.js";

const base: CriticalityInput = {
  max_tolerable_disruption: "gt_1_month",
  operational_dependency: "incidental",
  business_reach: "single_team",
  substitutability: "interchangeable",
  process_coupling: "peripheral",
  concentration: "none",
};
const v = (o: Partial<CriticalityInput>): CriticalityInput => ({ ...base, ...o });

describe("criticality — structural invariants", () => {
  it("weights sum to exactly 1.0", () => {
    const sum = Object.values(CRITICALITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });
  it("every dimension has a weight, and every weight a dimension", () => {
    expect(Object.keys(CRITICALITY_WEIGHTS).sort()).toEqual([...CRITICALITY_DIMENSIONS].sort());
  });
  it("concentration is the LOWEST-weight peer (owner ruling M1/M3)", () => {
    const min = Math.min(...Object.values(CRITICALITY_WEIGHTS));
    expect(CRITICALITY_WEIGHTS.concentration).toBe(min);
    expect(CRITICALITY_WEIGHTS.concentration).toBe(0.08);
  });
  it("is deterministic", () => {
    const i = v({ operational_dependency: "essential", business_reach: "enterprise_wide" });
    expect(JSON.stringify(computeVendorCriticality(i))).toBe(JSON.stringify(computeVendorCriticality(i)));
  });
  it("emits NO tier — the tier is a joint function and belongs to neither engine", () => {
    expect((computeVendorCriticality(base) as Record<string, unknown>).tier).toBeUndefined();
  });
  it("the input contract carries NO exposure or assurance facts (excluded by ruling)", () => {
    const keys = Object.keys(base).sort();
    for (const forbidden of ["data_sensitivity", "access_level", "ai_involvement", "regulatory_exposure", "control_effectiveness"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
  it("stamps method and version", () => {
    const r = computeVendorCriticality(base);
    expect(r.basis.method).toBe("vendor_criticality_v1");
    expect(r.basis.methodology_version).toBe("1.0.0");
    expect(r.basis.factors).toHaveLength(6);
  });
});

describe("criticality — monotonic in every dimension", () => {
  const ladders: Array<[keyof CriticalityInput, string[]]> = [
    ["max_tolerable_disruption", ["gt_1_month", "1_week_to_1_month", "1_to_7_days", "lt_24_hours"]],
    ["operational_dependency", ["incidental", "supporting", "significant", "essential"]],
    ["business_reach", ["single_team", "single_function", "multi_function", "enterprise_wide"]],
    ["substitutability", ["interchangeable", "replaceable_weeks", "replaceable_months", "no_viable_alternative"]],
    ["process_coupling", ["peripheral", "supports_critical_path", "in_critical_path", "embedded_no_manual_fallback"]],
    ["concentration", ["none", "low", "moderate", "single_point_of_failure"]],
  ];
  for (const [dim, levels] of ladders) {
    it(`${dim} never lowers the score as it worsens`, () => {
      let prev = -1;
      for (const level of levels) {
        const s = computeVendorCriticality(v({ [dim]: level } as Partial<CriticalityInput>)).score;
        expect(s).toBeGreaterThanOrEqual(prev);
        prev = s;
      }
    });
  }
});

describe("criticality — bands and floors", () => {
  it("benign baseline is Low; maximal profile is Critical", () => {
    expect(computeVendorCriticality(base).band).toBe("Low");
    expect(
      computeVendorCriticality(
        v({
          max_tolerable_disruption: "lt_24_hours",
          operational_dependency: "essential",
          business_reach: "enterprise_wide",
          substitutability: "no_viable_alternative",
          process_coupling: "embedded_no_manual_fallback",
          concentration: "single_point_of_failure",
        })
      ).score
    ).toBe(100);
  });
  it("uses the shared band thresholds", () => {
    expect(BAND_MIN_SCORE).toEqual({ Low: 0, Moderate: 25, High: 50, Critical: 75 });
  });
  it("CR1: <24h AND no viable alternative floors to Critical even when arithmetic is lower", () => {
    const r = computeVendorCriticality(v({ max_tolerable_disruption: "lt_24_hours", substitutability: "no_viable_alternative" }));
    expect(r.arithmetic_band).not.toBe("Critical");
    expect(r.band).toBe("Critical");
    expect(r.basis.adjustments.map((a) => a.rule_id)).toContain("CR1");
  });
  it("CR2: enterprise-wide AND <=7 days floors to High", () => {
    const r = computeVendorCriticality(v({ business_reach: "enterprise_wide", max_tolerable_disruption: "1_to_7_days" }));
    expect(r.band).toBe("High");
    expect(r.basis.adjustments.map((a) => a.rule_id)).toContain("CR2");
  });
  it("CR3: embedded with no fallback AND no alternative floors to High", () => {
    const r = computeVendorCriticality(v({ process_coupling: "embedded_no_manual_fallback", substitutability: "no_viable_alternative" }));
    expect(r.band).toBe("High");
    expect(r.basis.adjustments.map((a) => a.rule_id)).toContain("CR3");
  });
  it("floors raise the band, never the score", () => {
    const r = computeVendorCriticality(v({ max_tolerable_disruption: "lt_24_hours", substitutability: "no_viable_alternative" }));
    expect(r.score).toBeLessThan(BAND_MIN_SCORE.Critical);
  });
  it("every rule has a stable id and a customer-facing explanation", () => {
    for (const r of CRITICALITY_ESCALATION_RULES) {
      expect(r.rule_id).toMatch(/^CR\d$/);
      expect(r.explanation.length).toBeGreaterThan(20);
    }
  });
});

describe("criticality — owner-approved scenario table (band changes are methodology changes)", () => {
  const S: Array<[string, CriticalityInput, number, string]> = [
    ["Cloud infrastructure", v({ max_tolerable_disruption: "lt_24_hours", operational_dependency: "essential", business_reach: "enterprise_wide", substitutability: "no_viable_alternative", process_coupling: "embedded_no_manual_fallback", concentration: "single_point_of_failure" }), 100, "Critical"],
    ["Identity provider", v({ max_tolerable_disruption: "lt_24_hours", operational_dependency: "essential", business_reach: "enterprise_wide", substitutability: "replaceable_months", process_coupling: "embedded_no_manual_fallback", concentration: "moderate" }), 93, "Critical"],
    ["Payment processor", v({ max_tolerable_disruption: "lt_24_hours", operational_dependency: "essential", business_reach: "enterprise_wide", substitutability: "replaceable_months", process_coupling: "in_critical_path", concentration: "moderate" }), 90, "Critical"],
    ["Niche logistics", v({ max_tolerable_disruption: "1_to_7_days", operational_dependency: "essential", business_reach: "multi_function", substitutability: "no_viable_alternative", process_coupling: "in_critical_path", concentration: "single_point_of_failure" }), 84, "Critical"],
    ["Payroll processor", v({ max_tolerable_disruption: "1_to_7_days", operational_dependency: "significant", business_reach: "enterprise_wide", substitutability: "replaceable_months", process_coupling: "in_critical_path", concentration: "low" }), 73, "High"],
    ["CRM SaaS", v({ max_tolerable_disruption: "1_to_7_days", operational_dependency: "significant", business_reach: "multi_function", substitutability: "replaceable_months", process_coupling: "in_critical_path", concentration: "low" }), 68, "High"],
    ["Clinical AI transcription", v({ max_tolerable_disruption: "1_week_to_1_month", operational_dependency: "supporting", business_reach: "single_function", substitutability: "replaceable_weeks", process_coupling: "supports_critical_path", concentration: "none" }), 38, "Moderate"],
    ["Marketing analytics", v({ max_tolerable_disruption: "1_week_to_1_month", operational_dependency: "supporting", business_reach: "single_function", substitutability: "interchangeable", process_coupling: "peripheral", concentration: "none" }), 30, "Moderate"],
    ["Office catering", base, 10, "Low"],
  ];
  for (const [name, input, score, band] of S) {
    it(`${name} → ${score} ${band}`, () => {
      const r = computeVendorCriticality(input);
      expect(r.score).toBe(score);
      expect(r.band).toBe(band);
    });
  }
});
