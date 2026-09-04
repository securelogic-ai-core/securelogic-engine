import { describe, it, expect } from "vitest";
import { v1FactsFromRelationship } from "../lib/vendorRisk/relationshipEngagementBridge.js";
import type { RelationshipIntakeFacts } from "../lib/vendorRisk/relationshipClassification.js";
import { factAtLeast, resolveFacts, factsFromInherent } from "../lib/vendorRisk/factResolver.js";

const base: RelationshipIntakeFacts = {
  max_tolerable_disruption: "gt_1_month", operational_dependency: "incidental", business_reach: "single_team",
  substitutability: "interchangeable", process_coupling: "peripheral", concentration: "none",
  data_sensitivity: "none", data_volume: "minimal", access_level: "none", regulatory_exposure: "none",
  regulatory_breach_notification: false, ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem", fourth_party_exposure: "none",
};

describe("relationship -> engagement bridge (scoping vocabulary, not scoring)", () => {
  it("maps dependency by rank, criticality band to v1's 'medium' spelling, and MTD to recoverability by rank", () => {
    const v1 = v1FactsFromRelationship({ ...base, operational_dependency: "significant", max_tolerable_disruption: "1_to_7_days" }, "Moderate");
    expect(v1.operational_dependency).toBe("high");
    expect(v1.recoverability).toBe("weeks");
    expect(v1.business_criticality).toBe("medium");
  });
  it("passes identical-vocabulary facts through untouched", () => {
    const v1 = v1FactsFromRelationship({ ...base, data_sensitivity: "restricted", concentration: "single_point_of_failure", ai_involvement: "core", ai_autonomy: "human_on_the_loop" }, "Low");
    expect(v1.data_sensitivity).toBe("restricted");
    expect(v1.concentration).toBe("single_point_of_failure");
    expect(v1.ai_autonomy).toBe("human_on_the_loop");
  });
  it("the S5 resilience rules open for exactly the relationships they should", () => {
    // <= 7 days tolerance opens the recoverability rule; > 7 days does not.
    const tight = resolveFacts(factsFromInherent(v1FactsFromRelationship({ ...base, max_tolerable_disruption: "1_to_7_days" }, "Low")));
    const loose = resolveFacts(factsFromInherent(v1FactsFromRelationship({ ...base, max_tolerable_disruption: "1_week_to_1_month" }, "Low")));
    expect(factAtLeast(tight, "core.recoverability", "weeks")).toBe(true);
    expect(factAtLeast(loose, "core.recoverability", "weeks")).toBe(false);
    // A derived High criticality opens the criticality rule; Moderate does not.
    const hi = resolveFacts(factsFromInherent(v1FactsFromRelationship(base, "High")));
    const mid = resolveFacts(factsFromInherent(v1FactsFromRelationship(base, "Moderate")));
    expect(factAtLeast(hi, "core.business_criticality", "high")).toBe(true);
    expect(factAtLeast(mid, "core.business_criticality", "high")).toBe(false);
  });
  it("is total: every v2 level has a v1 image (no undefined leaks into the spine)", () => {
    for (const d of ["incidental", "supporting", "significant", "essential"] as const)
      for (const m of ["gt_1_month", "1_week_to_1_month", "1_to_7_days", "lt_24_hours"] as const)
        for (const b of ["Low", "Moderate", "High", "Critical"] as const) {
          const v1 = v1FactsFromRelationship({ ...base, operational_dependency: d, max_tolerable_disruption: m }, b);
          expect(Object.values(v1).every((x) => x !== undefined)).toBe(true);
        }
  });
});
