/**
 * assessmentTier.test.ts — tier as the joint function of criticality,
 * inherent risk and policy. The matrix is owner-frozen; every cell is pinned.
 */
import { describe, it, expect } from "vitest";
import {
  resolveAssessmentTier,
  TIER_MATRIX,
  TIER_RANKS,
  TIER_ESCALATION_RULES,
  type TierFloorFacts,
} from "../lib/vendorRisk/assessmentTier.js";
import { RISK_BANDS, tierForBand } from "../lib/vendorRisk/riskBands.js";

const benign: TierFloorFacts = { data_sensitivity: "none", access_level: "none", operational_dependency: "incidental", concentration: "none" };
const t = (c: (typeof RISK_BANDS)[number], i: (typeof RISK_BANDS)[number], facts: TierFloorFacts = benign, policy?: Parameters<typeof resolveAssessmentTier>[0]["policy_minimum_tier"]) =>
  resolveAssessmentTier({ criticality_band: c, inherent_band: i, facts, policy_minimum_tier: policy ?? null });

describe("assessment tier — the owner-frozen matrix, every cell pinned", () => {
  const expected: Record<string, string> = {
    "Critical/Low": "tier_2_high", "Critical/Moderate": "tier_2_high", "Critical/High": "tier_1_critical", "Critical/Critical": "tier_1_critical",
    "High/Low": "tier_3_moderate", "High/Moderate": "tier_3_moderate", "High/High": "tier_2_high", "High/Critical": "tier_1_critical",
    "Moderate/Low": "tier_4_low", "Moderate/Moderate": "tier_3_moderate", "Moderate/High": "tier_2_high", "Moderate/Critical": "tier_2_high",
    "Low/Low": "tier_4_low", "Low/Moderate": "tier_4_low", "Low/High": "tier_3_moderate", "Low/Critical": "tier_2_high",
  };
  for (const [k, tier] of Object.entries(expected)) {
    const [c, i] = k.split("/") as [(typeof RISK_BANDS)[number], (typeof RISK_BANDS)[number]];
    it(`(${c}, ${i}) → ${tier}`, () => {
      expect(TIER_MATRIX[c][i]).toBe(tier);
      expect(t(c, i).tier).toBe(tier);
    });
  }
  it("(Moderate, High) is tier_2 — the owner amendment", () => {
    expect(TIER_MATRIX.Moderate.High).toBe("tier_2_high");
  });
});

describe("assessment tier — MONOTONIC in both axes (owner requirement)", () => {
  it("increasing criticality never produces a lower-assurance tier", () => {
    for (const i of RISK_BANDS) {
      for (let k = 1; k < RISK_BANDS.length; k++) {
        const lower = TIER_RANKS[TIER_MATRIX[RISK_BANDS[k - 1]!][i]];
        const higher = TIER_RANKS[TIER_MATRIX[RISK_BANDS[k]!][i]];
        expect(higher).toBeGreaterThanOrEqual(lower);
      }
    }
  });
  it("increasing inherent risk never produces a lower-assurance tier", () => {
    for (const c of RISK_BANDS) {
      for (let k = 1; k < RISK_BANDS.length; k++) {
        const lower = TIER_RANKS[TIER_MATRIX[c][RISK_BANDS[k - 1]!]];
        const higher = TIER_RANKS[TIER_MATRIX[c][RISK_BANDS[k]!]];
        expect(higher).toBeGreaterThanOrEqual(lower);
      }
    }
  });
});

describe("assessment tier — relocated floors read RAW FACTS, never a band (M2)", () => {
  it("E1b: restricted + admin + essential floors to tier_1 even from a Low/Low cell", () => {
    const r = t("Low", "Low", { data_sensitivity: "restricted", access_level: "admin", operational_dependency: "essential", concentration: "none" });
    expect(r.matrix_tier).toBe("tier_4_low");
    expect(r.tier).toBe("tier_1_critical");
    expect(r.basis.adjustments.map((a) => a.rule_id)).toContain("E1b");
  });
  it("E4: single point of failure + essential floors to tier_2", () => {
    const r = t("Low", "Low", { ...benign, operational_dependency: "essential", concentration: "single_point_of_failure" });
    expect(r.tier).toBe("tier_2_high");
    expect(r.basis.adjustments.map((a) => a.rule_id)).toContain("E4");
  });
  it("only E1b and E4 live here", () => {
    expect(TIER_ESCALATION_RULES.map((r) => r.rule_id).sort()).toEqual(["E1b", "E4"]);
  });
  it("the floor facts contract holds no derived band", () => {
    expect(Object.keys(benign).sort()).toEqual(["access_level", "concentration", "data_sensitivity", "operational_dependency"]);
  });
});

describe("assessment tier — customer policy is RAISE-ONLY (M4)", () => {
  it("policy raises a tier_4 relationship to tier_2 when it asks to", () => {
    const r = t("Low", "Low", benign, "tier_2_high");
    expect(r.calculated_minimum_tier).toBe("tier_4_low");
    expect(r.tier).toBe("tier_2_high");
    expect(r.basis.policy?.applied).toBe(true);
    expect(r.basis.adjustments.map((a) => a.rule_id)).toContain("POLICY_RAISE");
  });
  it("policy can NEVER lower the calculated minimum", () => {
    const r = t("Critical", "Critical", benign, "tier_4_low");
    expect(r.tier).toBe("tier_1_critical");
    expect(r.basis.policy?.applied).toBe(false);
    expect(r.basis.policy?.reason).toMatch(/never lower/);
  });
  it("policy equal to the minimum is a no-op, not a raise", () => {
    const r = t("High", "High", benign, "tier_2_high");
    expect(r.tier).toBe("tier_2_high");
    expect(r.basis.policy?.applied).toBe(false);
    expect(r.basis.adjustments.map((a) => a.rule_id)).not.toContain("POLICY_RAISE");
  });
  it("policy cannot lower a tier that a floor raised", () => {
    const r = t("Low", "Low", { data_sensitivity: "restricted", access_level: "admin", operational_dependency: "essential", concentration: "none" }, "tier_4_low");
    expect(r.tier).toBe("tier_1_critical");
  });
});

describe("assessment tier — supersedes, but does not break, tierForBand", () => {
  it("tierForBand (v1, inherent-only) still exists for historical reproduction", () => {
    expect(tierForBand("Critical")).toBe("tier_1_critical");
    expect(tierForBand("Low")).toBe("tier_4_low");
  });
  it("the joint model DIFFERS from inherent-only where criticality matters — the reason it exists", () => {
    // Critical dependency, Moderate exposure: v1 said tier_3; v2 says tier_2.
    expect(tierForBand("Moderate")).toBe("tier_3_moderate");
    expect(t("Critical", "Moderate").tier).toBe("tier_2_high");
  });
});
