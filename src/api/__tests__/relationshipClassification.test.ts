import { describe, it, expect } from "vitest";
import { classifyRelationship, type RelationshipIntakeFacts } from "../lib/vendorRisk/relationshipClassification.js";

const paymentProcessor: RelationshipIntakeFacts = {
  max_tolerable_disruption: "lt_24_hours", operational_dependency: "essential", business_reach: "enterprise_wide",
  substitutability: "replaceable_months", process_coupling: "in_critical_path", concentration: "moderate",
  data_sensitivity: "restricted", data_volume: "large", access_level: "read_write", regulatory_exposure: "high",
  regulatory_breach_notification: false, ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas", fourth_party_exposure: "moderate",
};

describe("relationship classification — the one composition point", () => {
  it("reproduces the owner-approved Payment processor scenario end to end", () => {
    const c = classifyRelationship(paymentProcessor, null);
    expect(c.criticality.score).toBe(90); expect(c.criticality.band).toBe("Critical");
    expect(c.inherent.score).toBe(70); expect(c.inherent.band).toBe("High");
    expect(c.tier.tier).toBe("tier_1_critical");
  });
  it("is deterministic across calls", () => {
    expect(JSON.stringify(classifyRelationship(paymentProcessor, null))).toBe(JSON.stringify(classifyRelationship(paymentProcessor, null)));
  });
  it("policy raises but never lowers", () => {
    const low: RelationshipIntakeFacts = { ...paymentProcessor, max_tolerable_disruption: "gt_1_month", operational_dependency: "incidental", business_reach: "single_team", substitutability: "interchangeable", process_coupling: "peripheral", concentration: "none", data_sensitivity: "none", data_volume: "minimal", access_level: "none", regulatory_exposure: "none", hosting_model: "on_prem", fourth_party_exposure: "none" };
    expect(classifyRelationship(low, null).tier.tier).toBe("tier_4_low");
    expect(classifyRelationship(low, "tier_2_high").tier.tier).toBe("tier_2_high");
    expect(classifyRelationship(paymentProcessor, "tier_4_low").tier.tier).toBe("tier_1_critical");
  });
  it("the tier engine never sees a derived band from a peer as a floor input", () => {
    const c = classifyRelationship(paymentProcessor, null);
    expect(c.tier.basis.criticality_band).toBe(c.criticality.band);
    expect(c.tier.basis.inherent_band).toBe(c.inherent.band);
    // Tier floors are E1b/E4 only; neither fires here.
    expect(c.tier.basis.adjustments.map((a) => a.rule_id)).toEqual([]);
  });
});
