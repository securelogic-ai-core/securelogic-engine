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
  it("reports ONLY the three sourceable dimensions — no revenue/customer placeholders", () => {
    // Was: "marks revenue and customer not_assessed". Those two were hardcoded
    // literals with no schema column behind them and no code path that could ever
    // set them to anything else. A row that can only say one thing is not a
    // measurement — it is removed, not faked.
    const bi = assessBusinessImpact({ vendors: 0, ai_systems: 0, controls: 0, obligations: 0 }, "Low");
    expect(Object.keys(bi).sort()).toEqual(["operational", "regulatory", "third_party"]);
    expect(bi).not.toHaveProperty("revenue");
    expect(bi).not.toHaveProperty("customer");
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

describe("assessBusinessImpact — Context Contract honesty (resolution-aware)", () => {
  const zero = { vendors: 0, ai_systems: 0, controls: 0, obligations: 0 };

  it("zero + path ran = honest 'none'", () => {
    const bi = assessBusinessImpact(zero, "High", {
      vendors: "none_found", ai_systems: "none_found", controls: "none_found", obligations: "none_found",
    });
    expect(bi.third_party.level).toBe("none");
    expect(bi.third_party.note).toBe("No vendor in your inventory matches this finding");
    expect(bi.regulatory.level).toBe("none");
    expect(bi.operational.level).toBe("none");
  });

  it("zero + no path = not_assessed, and never claims 'No affected vendors'", () => {
    const bi = assessBusinessImpact(zero, "High", {
      vendors: "not_applicable", ai_systems: "not_applicable", controls: "not_applicable", obligations: "not_applicable",
    });
    expect(bi.third_party.level).toBe("not_assessed");
    expect(bi.third_party.note).not.toContain("No affected vendors");
    expect(bi.third_party.note).toContain("not resolvable");
    expect(bi.regulatory.level).toBe("not_assessed");
    expect(bi.operational.level).toBe("not_assessed");
  });

  it("operational is honest-zero if EITHER contributing bucket ran", () => {
    const bi = assessBusinessImpact(zero, "High", {
      vendors: "not_applicable", ai_systems: "none_found", controls: "not_applicable", obligations: "not_applicable",
    });
    expect(bi.operational.level).toBe("none");
  });

  it("positive counts resolve to levels regardless of resolution bookkeeping", () => {
    const bi = assessBusinessImpact({ vendors: 1, ai_systems: 0, controls: 0, obligations: 0 }, "Low", {
      vendors: "resolved", ai_systems: "not_applicable", controls: "not_applicable", obligations: "not_applicable",
    });
    expect(bi.third_party.level).toBe("low");
    expect(bi.third_party.note).toContain("1 affected vendor");
  });

  it("omitting resolution preserves the legacy count-only behaviour", () => {
    const bi = assessBusinessImpact(zero, "High");
    expect(bi.third_party.level).toBe("none");
    expect(bi.third_party.note).toBe("No vendor in your inventory matches this finding");
  });

  it("never reintroduces an unsourceable dimension, even when everything resolves", () => {
    const bi = assessBusinessImpact({ vendors: 3, ai_systems: 3, controls: 3, obligations: 3 }, "Critical", {
      vendors: "resolved", ai_systems: "resolved", controls: "resolved", obligations: "resolved",
    });
    expect(Object.keys(bi).sort()).toEqual(["operational", "regulatory", "third_party"]);
  });
});
