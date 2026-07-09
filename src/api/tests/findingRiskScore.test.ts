import { describe, it, expect } from "vitest";
import { computeFindingRiskScore, assessBusinessImpact } from "../lib/findingRiskScore.js";

describe("computeFindingRiskScore (pure, deterministic, explainable)", () => {
  it("severity dominates and is traced", () => {
    const r = computeFindingRiskScore({ severity: "Critical", priority: null, confidence: null });
    expect(r.score).toBe(90);
    expect(r.band).toBe("Critical");
    expect(r.rationale.join(" ")).toContain("Severity Critical");
  });

  it("priority nudges urgency and confidence discounts", () => {
    const immediate = computeFindingRiskScore({ severity: "High", priority: "immediate", confidence: 100 });
    expect(immediate.score).toBe(80); // 70 + 10 + 0
    const watchedLowConf = computeFindingRiskScore({ severity: "High", priority: "watch", confidence: 0 });
    expect(watchedLowConf.score).toBe(45); // 70 - 10 - 15
  });

  it("clamps to [0,100] and defaults unknown severity", () => {
    const unknown = computeFindingRiskScore({ severity: null, priority: null, confidence: null });
    expect(unknown.score).toBe(40);
    const low = computeFindingRiskScore({ severity: "Low", priority: "watch", confidence: 0 });
    expect(low.score).toBeGreaterThanOrEqual(0);
  });

  it("is reproducible", () => {
    const a = computeFindingRiskScore({ severity: "Moderate", priority: "planned", confidence: 60 });
    const b = computeFindingRiskScore({ severity: "Moderate", priority: "planned", confidence: 60 });
    expect(a).toEqual(b);
  });
});

describe("assessBusinessImpact (never fabricates)", () => {
  it("marks revenue and customer not_assessed", () => {
    const bi = assessBusinessImpact({ vendors: 0, ai_systems: 0, controls: 0, obligations: 0 }, "Low");
    expect(bi.revenue.level).toBe("not_assessed");
    expect(bi.customer.level).toBe("not_assessed");
  });

  it("derives third-party / regulatory / operational from affected counts + band", () => {
    const bi = assessBusinessImpact({ vendors: 3, ai_systems: 1, controls: 2, obligations: 1 }, "Critical");
    expect(bi.third_party.level).toBe("high"); // 3 vendors, high band
    expect(bi.regulatory.level).toBe("medium"); // 1 obligation, high band
    expect(bi.operational.level).toBe("high"); // 3 op entities, high band
    expect(bi.third_party.note).toContain("3 affected vendor");
  });

  it("returns none for dimensions with no affected entities", () => {
    const bi = assessBusinessImpact({ vendors: 0, ai_systems: 0, controls: 0, obligations: 0 }, "High");
    expect(bi.third_party.level).toBe("none");
    expect(bi.operational.level).toBe("none");
  });
});
