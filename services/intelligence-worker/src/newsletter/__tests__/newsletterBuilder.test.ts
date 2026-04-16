import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock postgres + insight store before importing newsletterBuilder to avoid DATABASE_URL throw
vi.mock("../../../../../src/api/infra/postgres.js", () => ({
  pg: { query: vi.fn() }
}));
vi.mock("../../../storage/postgresInsightStore.js", () => ({
  getInsights: vi.fn()
}));

import { normalizeInsight, enrichSignalsWithRationale, toBriefItem } from "../newsletterBuilder.js";

// ---------------------------------------------------------------------------
// normalizeInsight
// ---------------------------------------------------------------------------

describe("normalizeInsight", () => {
  it("preserves rawContent from the analysis field", () => {
    const insight = {
      id: "ins-1",
      analysis: "Full raw source content from original article",
      risk_implication: "",
      recommendation: "",
      risk_level: "high",
      category: "SECURITY_INCIDENT",
      title: "Test signal",
      source: "test",
      signal_id: "sig-1"
    };

    const result = normalizeInsight(insight);
    expect(result.rawContent).toBe("Full raw source content from original article");
  });

  it("sets analysis to rawContent (not an empty string or template)", () => {
    const rawText = "Zero-day in Cisco IOS under active exploitation CVE-2025-12345";
    const insight = {
      id: "ins-1",
      analysis: rawText,
      risk_level: "high",
      category: "SECURITY_INCIDENT",
      title: "Cisco zero-day",
      source: "test",
      signal_id: "sig-1"
    };

    const result = normalizeInsight(insight);
    expect(result.analysis).toBe(rawText);
  });

  it("extracts CVE from raw content", () => {
    const insight = {
      id: "ins-1",
      analysis: "Critical vulnerability CVE-2025-99999 in OpenSSL",
      risk_level: "high",
      category: "SECURITY_INCIDENT",
      title: "OpenSSL flaw",
      source: "test",
      signal_id: "sig-1"
    };

    const result = normalizeInsight(insight);
    expect(result.affectedCve).toBe("CVE-2025-99999");
  });

  it("sets affectedCve to null when no CVE in content", () => {
    const insight = {
      id: "ins-1",
      analysis: "Regulatory update on AI governance",
      risk_level: "medium",
      category: "REGULATION",
      title: "AI Act guidance",
      source: "test",
      signal_id: "sig-1"
    };

    const result = normalizeInsight(insight);
    expect(result.affectedCve).toBeNull();
  });

  it("extracts vendor from title", () => {
    const insight = {
      id: "ins-1",
      analysis: "Remote code execution in Fortinet FortiOS",
      risk_level: "high",
      category: "SECURITY_INCIDENT",
      title: "Fortinet FortiOS critical RCE",
      source: "test",
      signal_id: "sig-1"
    };

    const result = normalizeInsight(insight);
    expect(result.affectedVendor).toBe("Fortinet");
  });
});

// ---------------------------------------------------------------------------
// enrichSignalsWithRationale — applies to all high/critical, not just top 3
// ---------------------------------------------------------------------------

vi.mock("../../pipeline/llmClient.js", () => ({
  analyzeSignal: vi.fn(),
  synthesizeBrief: vi.fn(),
  generateThesisHeadline: vi.fn(),
  generateCrossDomainAnalysis: vi.fn(),
  generateActionSummary: vi.fn(),
  generateRiskRationale: vi.fn().mockResolvedValue("Scored High because active exploitation confirmed with no patch available")
}));

// Expose ANTHROPIC_API_KEY so the function doesn't short-circuit
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("enrichSignalsWithRationale", () => {
  it("enriches all high signals, not just top 3", async () => {
    const signals = Array.from({ length: 5 }, (_, i) => ({
      id: `sig-${i}`,
      signal_id: `sig-${i}`,
      title: `High signal ${i}`,
      riskLevel: "high",
      analysis: "Some analysis",
      category: "SECURITY_INCIDENT"
    }));

    const result = await enrichSignalsWithRationale(signals);

    // All 5 should have a riskRationale, not just the first 3
    const withRationale = result.filter((s) => s.riskRationale);
    expect(withRationale.length).toBe(5);
  });

  it("does not enrich low/medium signals", async () => {
    const signals = [
      { id: "low-1", signal_id: "low-1", title: "Low signal", riskLevel: "low", analysis: "", category: "GENERAL" },
      { id: "med-1", signal_id: "med-1", title: "Medium signal", riskLevel: "medium", analysis: "", category: "REGULATION" },
      { id: "hi-1", signal_id: "hi-1", title: "High signal", riskLevel: "high", analysis: "", category: "SECURITY_INCIDENT" }
    ];

    const result = await enrichSignalsWithRationale(signals);

    expect(result.find((s) => s.id === "low-1")?.riskRationale).toBeUndefined();
    expect(result.find((s) => s.id === "med-1")?.riskRationale).toBeUndefined();
    expect(result.find((s) => s.id === "hi-1")?.riskRationale).toBeDefined();
  });

  it("returns all signals (not just enriched ones)", async () => {
    const signals = [
      { id: "hi-1", signal_id: "hi-1", title: "High signal", riskLevel: "high", analysis: "", category: "SECURITY_INCIDENT" },
      { id: "low-1", signal_id: "low-1", title: "Low signal", riskLevel: "low", analysis: "", category: "GENERAL" }
    ];

    const result = await enrichSignalsWithRationale(signals);
    expect(result.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// toBriefItem — canonical output projection
// ---------------------------------------------------------------------------

describe("toBriefItem", () => {
  function makeEnrichedSignal(overrides: Record<string, unknown> = {}) {
    return {
      signal_id: "sig-123",
      title: "Fortinet FortiOS RCE CVE-2025-99999",
      category: "SECURITY_INCIDENT",
      riskLevel: "high",
      analysis: "Fortinet disclosed a critical RCE in FortiOS affecting versions 7.x.",
      whyItMatters: "Organizations using Fortinet VPN are at immediate exposure risk.",
      recommendation: "Security team: patch all Fortinet FortiOS 7.x deployments within 72 hours.",
      audience: "Security Leaders, Risk Teams",
      source: "fortinet-psirt",
      source_url: "https://example.com/advisory",
      priorityScore: 85,
      priorityTier: "IMMEDIATE",
      affectedCve: "CVE-2025-99999",
      affectedVendor: "Fortinet",
      riskRationale: "Scored High: active exploitation confirmed, no compensating control available.",
      orgRelevance: null,
      // Internal pipeline fields that must NOT appear in the output
      rawContent: "Full raw article text...",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      organization_id: null,
      risk_implication: "",
      ...overrides
    };
  }

  it("includes all required output fields", () => {
    const item = toBriefItem(makeEnrichedSignal());
    const keys = Object.keys(item);

    expect(keys).toContain("title");
    expect(keys).toContain("severity");
    expect(keys).toContain("category");
    expect(keys).toContain("audience");
    expect(keys).toContain("analysis");
    expect(keys).toContain("whyItMatters");
    expect(keys).toContain("recommendation");
    expect(keys).toContain("priorityScore");
    expect(keys).toContain("priorityTier");
    expect(keys).toContain("affectedCve");
    expect(keys).toContain("affectedVendor");
    expect(keys).toContain("riskRationale");
    expect(keys).toContain("orgRelevance");
  });

  it("sets severity as normalized riskLevel", () => {
    const item = toBriefItem(makeEnrichedSignal({ riskLevel: "HIGH" }));
    expect(item.severity).toBe("high");
  });

  it("keeps riskLevel as backward-compat alias equal to severity", () => {
    const item = toBriefItem(makeEnrichedSignal({ riskLevel: "critical" }));
    expect(item.riskLevel).toBe("critical");
    expect(item.severity).toBe("critical");
  });

  it("sets orgRelevance to null by default", () => {
    const item = toBriefItem(makeEnrichedSignal());
    expect(item.orgRelevance).toBeNull();
  });

  it("passes affectedCve through", () => {
    const item = toBriefItem(makeEnrichedSignal({ affectedCve: "CVE-2025-99999" }));
    expect(item.affectedCve).toBe("CVE-2025-99999");
  });

  it("passes affectedVendor through", () => {
    const item = toBriefItem(makeEnrichedSignal({ affectedVendor: "Fortinet" }));
    expect(item.affectedVendor).toBe("Fortinet");
  });

  it("includes audience from insight", () => {
    const item = toBriefItem(makeEnrichedSignal({ audience: "Security Leaders, Risk Teams" }));
    expect(item.audience).toBe("Security Leaders, Risk Teams");
  });

  it("does NOT include internal pipeline fields", () => {
    const item = toBriefItem(makeEnrichedSignal());
    expect(item).not.toHaveProperty("rawContent");
    expect(item).not.toHaveProperty("created_at");
    expect(item).not.toHaveProperty("updated_at");
    expect(item).not.toHaveProperty("organization_id");
    expect(item).not.toHaveProperty("risk_implication");
  });

  it("sets recommendation and backward-compat recommendedAction to the same value", () => {
    const rec = "Security team: patch immediately.";
    const item = toBriefItem(makeEnrichedSignal({ recommendation: rec }));
    expect(item.recommendation).toBe(rec);
    expect(item.recommendedAction).toBe(rec);
  });

  it("falls back to recommendedAction when recommendation is absent", () => {
    const rec = "Patch all affected systems within 48 hours.";
    const signal = makeEnrichedSignal();
    delete (signal as any).recommendation;
    (signal as any).recommendedAction = rec;
    const item = toBriefItem(signal);
    expect(item.recommendation).toBe(rec);
  });
});
