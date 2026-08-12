/**
 * vendorInherentRisk.test.ts — the deterministic inherent-risk model.
 *
 * These are the invariants the ratified methodology turns on, not incidental
 * coverage. The four worked profiles are the ones the operator approved, so a
 * change that moves any of their BANDS is a methodology change and must be a
 * version bump, not a patch.
 */
import { describe, it, expect } from "vitest";
import {
  computeVendorInherentRisk,
  DIMENSION_WEIGHTS,
  ESCALATION_RULES,
  INHERENT_DIMENSIONS,
  type InherentRiskInput,
} from "../lib/vendorRisk/inherentRisk.js";
import { bandForScore, BAND_MIN_SCORE } from "../lib/vendorRisk/riskBands.js";
import { METHODOLOGY_VERSION } from "../lib/vendorRisk/methodologyVersion.js";

/** A benign baseline; each profile overrides only what it means to say. */
const base: InherentRiskInput = {
  data_sensitivity: "none",
  data_volume: "minimal",
  access_level: "none",
  operational_dependency: "low",
  recoverability: "hours",
  business_criticality: "low",
  regulatory_exposure: "none",
  regulatory_breach_notification: false,
  ai_involvement: "none",
  ai_autonomy: "none",
  hosting_model: "on_prem",
  fourth_party_exposure: "none",
  concentration: "none",
};
const v = (o: Partial<InherentRiskInput>): InherentRiskInput => ({ ...base, ...o });

// ─── Structural invariants ──────────────────────────────────────────────────

describe("inherent risk — structural invariants", () => {
  it("weights sum to exactly 1.0", () => {
    // A drift here silently rescales every vendor in the portfolio.
    const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("every dimension has a weight, and every weight a dimension", () => {
    expect(Object.keys(DIMENSION_WEIGHTS).sort()).toEqual([...INHERENT_DIMENSIONS].sort());
  });

  it("is DETERMINISTIC — identical inputs produce byte-identical output", () => {
    // The core ratified property: reproducible without an LLM, forever.
    const input = v({ data_sensitivity: "confidential", access_level: "read_write" });
    const a = JSON.stringify(computeVendorInherentRisk(input));
    const b = JSON.stringify(computeVendorInherentRisk(input));
    expect(a).toBe(b);
  });

  it("stamps the methodology version into the basis", () => {
    const r = computeVendorInherentRisk(base);
    expect(r.basis.methodology_version).toBe(METHODOLOGY_VERSION);
    expect(r.basis.method).toBe("vendor_inherent_v1");
  });

  it("emits one factor per dimension, each with a customer-facing explanation", () => {
    const r = computeVendorInherentRisk(base);
    expect(r.basis.factors).toHaveLength(INHERENT_DIMENSIONS.length);
    for (const f of r.basis.factors) {
      expect(f.explanation.length).toBeGreaterThan(10);
      expect(f.contribution).toBeCloseTo(f.raw * f.weight, 6);
    }
  });

  it("is MONOTONIC — worsening one dimension never lowers the score", () => {
    const mild = computeVendorInherentRisk(v({ data_sensitivity: "internal" })).score;
    const worse = computeVendorInherentRisk(v({ data_sensitivity: "confidential" })).score;
    const worst = computeVendorInherentRisk(v({ data_sensitivity: "restricted" })).score;
    expect(worse).toBeGreaterThanOrEqual(mild);
    expect(worst).toBeGreaterThanOrEqual(worse);
  });

  it("scores stay inside 0..100 at both extremes", () => {
    expect(computeVendorInherentRisk(base).score).toBeGreaterThanOrEqual(0);
    const maxed = computeVendorInherentRisk({
      data_sensitivity: "restricted",
      data_volume: "mass",
      access_level: "network_access",
      operational_dependency: "critical",
      recoverability: "none",
      business_criticality: "critical",
      regulatory_exposure: "high",
      regulatory_breach_notification: true,
      ai_involvement: "core",
      ai_autonomy: "autonomous_consequential",
      hosting_model: "multi_tenant_saas",
      fourth_party_exposure: "high",
      concentration: "single_point_of_failure",
    });
    expect(maxed.score).toBeLessThanOrEqual(100);
    expect(maxed.band).toBe("Critical");
  });
});

// ─── Sub-factor structure ───────────────────────────────────────────────────

describe("inherent risk — conditional sub-factors", () => {
  it("volume AMPLIFIES sensitivity and never creates risk alone", () => {
    // The reason data_volume is a sub-factor, not a peer dimension: mass volume
    // of public data must not outrank low volume of restricted data.
    const massPublic = computeVendorInherentRisk(
      v({ data_sensitivity: "none", data_volume: "mass" })
    );
    const minimalRestricted = computeVendorInherentRisk(
      v({ data_sensitivity: "restricted", data_volume: "minimal" })
    );
    const dataFactor = (r: typeof massPublic) =>
      r.basis.factors.find((f) => f.dimension === "data_exposure")!.raw;

    expect(dataFactor(massPublic)).toBe(0);
    expect(dataFactor(minimalRestricted)).toBeGreaterThan(0);
  });

  it("AI autonomy is INERT when there is no AI", () => {
    // A vendor with no AI cannot have autonomy — conditional by construction.
    const noAi = computeVendorInherentRisk(
      v({ ai_involvement: "none", ai_autonomy: "autonomous_consequential" })
    );
    expect(noAi.basis.factors.find((f) => f.dimension === "ai_exposure")!.raw).toBe(0);
    // …and E2 must not fire off an autonomy value that cannot apply.
    expect(noAi.basis.adjustments.find((a) => a.rule_id === "E2")).toBeUndefined();
  });

  it("network access is scored ONCE, inside access_exposure", () => {
    // The merge that removed double-counting: `vendors.access_level` already
    // carries network_access as its top value, so there is no separate
    // connectivity dimension to also score it.
    const r = computeVendorInherentRisk(v({ access_level: "network_access" }));
    expect(r.basis.factors.filter((f) => /connect|network/i.test(f.dimension))).toHaveLength(0);
    expect(r.basis.factors.find((f) => f.dimension === "access_exposure")!.raw).toBe(100);
  });
});

// ─── Escalation floors ──────────────────────────────────────────────────────

describe("inherent risk — escalation floors", () => {
  it("E1 fires on restricted data + privileged access, and RAISES a Moderate arithmetic result", () => {
    // The case E1 exists for: small, low-criticality, entirely replaceable
    // vendor with a network tap into restricted data. The weights score it
    // Moderate because it is small; E1 overrides because a compromise there is
    // a compromise of the crown jewels.
    const r = computeVendorInherentRisk(
      v({ data_sensitivity: "restricted", access_level: "network_access" })
    );
    expect(r.arithmetic_band).toBe("Moderate");
    expect(r.band).toBe("High");
    expect(r.tier).toBe("tier_2_high");
    const e1 = r.basis.adjustments.find((a) => a.rule_id === "E1");
    expect(e1).toBeTruthy();
    expect(e1!.explanation).toMatch(/Raised from Moderate to High/);
  });

  it("E1 does NOT fire on read_write — privileged means admin or network", () => {
    // Read/write access to data is not the same as administrative control over
    // the systems holding it. Loosening this would tier most of the portfolio
    // High and destroy the signal.
    const r = computeVendorInherentRisk(
      v({ data_sensitivity: "restricted", access_level: "read_write" })
    );
    expect(r.basis.adjustments.find((a) => a.rule_id === "E1")).toBeUndefined();
  });

  it("E1 does NOT fire below restricted sensitivity", () => {
    const r = computeVendorInherentRisk(
      v({ data_sensitivity: "confidential", access_level: "admin" })
    );
    expect(r.basis.adjustments.find((a) => a.rule_id === "E1")).toBeUndefined();
  });

  it("E1b escalates to Critical when the vendor also cannot be disconnected", () => {
    const r = computeVendorInherentRisk(
      v({
        data_sensitivity: "restricted",
        access_level: "admin",
        operational_dependency: "critical",
      })
    );
    expect(r.band).toBe("Critical");
    expect(r.basis.adjustments.map((a) => a.rule_id)).toContain("E1b");
  });

  it("E2 fires on autonomous consequential AI", () => {
    const r = computeVendorInherentRisk(
      v({ ai_involvement: "core", ai_autonomy: "autonomous_consequential" })
    );
    expect(r.band).toBe("High");
    expect(r.basis.adjustments.map((a) => a.rule_id)).toContain("E2");
  });

  it("E3 needs BOTH a breach-notification duty and confidential-or-worse data", () => {
    const dutyOnly = computeVendorInherentRisk(
      v({ regulatory_breach_notification: true, data_sensitivity: "internal" })
    );
    expect(dutyOnly.basis.adjustments.find((a) => a.rule_id === "E3")).toBeUndefined();

    const both = computeVendorInherentRisk(
      v({ regulatory_breach_notification: true, data_sensitivity: "confidential" })
    );
    expect(both.basis.adjustments.map((a) => a.rule_id)).toContain("E3");
    expect(both.band).toBe("High");
  });

  it("E4 fires on a single point of failure for a critical dependency", () => {
    const r = computeVendorInherentRisk(
      v({ concentration: "single_point_of_failure", operational_dependency: "critical" })
    );
    expect(r.basis.adjustments.map((a) => a.rule_id)).toContain("E4");
    expect(r.band).toBe("High");
  });

  it("records a NON-binding escalation rather than hiding it", () => {
    // A rule that fires but does not move the band is still evidence about the
    // vendor and must stay visible — silently dropping it would make the panel
    // look like the rule never applied.
    const r = computeVendorInherentRisk(
      v({
        data_sensitivity: "restricted",
        data_volume: "mass",
        access_level: "network_access",
        operational_dependency: "critical",
        business_criticality: "critical",
        regulatory_exposure: "high",
      })
    );
    expect(r.band).toBe("Critical");
    const e1 = r.basis.adjustments.find((a) => a.rule_id === "E1");
    expect(e1).toBeTruthy();
    expect(e1!.explanation).toMatch(/Already at or above/);
  });

  it("every escalation rule carries a customer-readable explanation", () => {
    for (const rule of ESCALATION_RULES) {
      expect(rule.explanation.length, `${rule.rule_id} explanation too short`).toBeGreaterThan(40);
    }
  });
});

// ─── The four ratified reference profiles ───────────────────────────────────
//
// Approved by the operator as part of the methodology. A change that moves any
// of these BANDS is a methodology change: bump METHODOLOGY_VERSION, do not
// quietly adjust a weight.

describe("inherent risk — ratified reference profiles", () => {
  it("Vendor A — marketing analytics SaaS, no customer data → Low / Tier 4", () => {
    const r = computeVendorInherentRisk(
      v({
        operational_dependency: "low",
        business_criticality: "low",
        hosting_model: "multi_tenant_saas",
        fourth_party_exposure: "low",
      })
    );
    expect(r.band).toBe("Low");
    expect(r.tier).toBe("tier_4_low");
    expect(r.basis.adjustments).toHaveLength(0);
  });

  it("Vendor B — US payroll processor, confidential PII, read-only → Moderate / Tier 3", () => {
    const r = computeVendorInherentRisk(
      v({
        data_sensitivity: "confidential",
        data_volume: "moderate",
        access_level: "read_only",
        operational_dependency: "moderate",
        recoverability: "days",
        business_criticality: "high",
        regulatory_exposure: "moderate",
        hosting_model: "multi_tenant_saas",
        fourth_party_exposure: "moderate",
        concentration: "low",
      })
    );
    expect(r.band).toBe("Moderate");
    expect(r.tier).toBe("tier_3_moderate");
  });

  it("Vendor C — cloud infrastructure, restricted data, read_write → High / Tier 2, E1 silent", () => {
    const r = computeVendorInherentRisk(
      v({
        data_sensitivity: "restricted",
        data_volume: "large",
        access_level: "read_write",
        operational_dependency: "critical",
        recoverability: "days",
        business_criticality: "high",
        regulatory_exposure: "moderate",
        regulatory_breach_notification: true,
        hosting_model: "multi_tenant_saas",
        fourth_party_exposure: "high",
        concentration: "moderate",
      })
    );
    expect(r.band).toBe("High");
    expect(r.tier).toBe("tier_2_high");
    // read_write is not privileged control, so E1 must stay silent even though
    // the data is restricted. E3 does fire (breach duty + restricted data).
    expect(r.basis.adjustments.find((a) => a.rule_id === "E1")).toBeUndefined();
    expect(r.basis.adjustments.map((a) => a.rule_id)).toContain("E3");
  });

  it("Vendor D — AI claims adjudication, restricted PHI, admin, sole provider → Critical / Tier 1", () => {
    const r = computeVendorInherentRisk({
      data_sensitivity: "restricted",
      data_volume: "mass",
      access_level: "admin",
      operational_dependency: "critical",
      recoverability: "none",
      business_criticality: "critical",
      regulatory_exposure: "high",
      regulatory_breach_notification: true,
      ai_involvement: "core",
      ai_autonomy: "autonomous_consequential",
      hosting_model: "multi_tenant_saas",
      fourth_party_exposure: "high",
      concentration: "single_point_of_failure",
    });
    expect(r.band).toBe("Critical");
    expect(r.tier).toBe("tier_1_critical");
    // All four escalations fire — and none of them CHANGES the band, which is
    // itself informative: this vendor is Critical on the arithmetic alone.
    expect(r.arithmetic_band).toBe("Critical");
    const ids = r.basis.adjustments.map((a) => a.rule_id);
    expect(ids).toEqual(expect.arrayContaining(["E1", "E1b", "E2", "E3", "E4"]));
  });
});

// ─── Band mapping ───────────────────────────────────────────────────────────

describe("inherent risk — band cut points match the risk register", () => {
  it("uses the shipped risk-register thresholds", () => {
    // docs/scoring-vocabulary.md: Critical >=75, High >=50, Moderate >=25, Low <25.
    // No new vocabulary is introduced by this methodology.
    expect(BAND_MIN_SCORE).toEqual({ Low: 0, Moderate: 25, High: 50, Critical: 75 });
    expect(bandForScore(74)).toBe("High");
    expect(bandForScore(75)).toBe("Critical");
    expect(bandForScore(24)).toBe("Low");
    expect(bandForScore(25)).toBe("Moderate");
  });
});
