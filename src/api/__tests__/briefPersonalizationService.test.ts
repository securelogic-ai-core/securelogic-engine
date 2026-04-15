import { describe, it, expect } from "vitest";

import {
  normalizeText,
  nameAppearsIn,
  extractCves,
  extractObligationKeywords,
  matchVendors,
  matchAiSystems,
  matchRisks,
  matchObligations,
  personalizeItem,
  personalizeItems,
  type VendorRecord,
  type RiskRecord,
  type AiSystemRecord,
  type ObligationRecord,
  type OrgPlatformContext
} from "../lib/briefPersonalizationService.js";
import type { BriefItem } from "../lib/intelligenceBriefGenerator.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY_CONTEXT: OrgPlatformContext = {
  vendors: [],
  risks: [],
  ai_systems: [],
  obligations: []
};

function makeItem(overrides: Partial<BriefItem> = {}): BriefItem {
  return {
    cyber_signal_id: "sig-001",
    category: "vulnerability",
    relevance: "high",
    title: "Critical Vulnerability in Cisco IOS XE Web UI",
    summary: "A privilege escalation flaw in Cisco IOS XE allows remote attackers to gain admin access.",
    affected_cve: "CVE-2023-20198",
    affected_vendor: "Cisco",
    source_slug: "cisa_kev",
    signal_type: "cve",
    severity: "Critical",
    ingestion_timestamp: "2024-01-15T00:00:00Z",
    sort_order: 0,
    ...overrides
  };
}

const vendorCisco: VendorRecord = { id: "v-cisco", name: "Cisco" };
const vendorFortinet: VendorRecord = { id: "v-fort", name: "Fortinet" };
const vendorPaloAlto: VendorRecord = { id: "v-pa", name: "Palo Alto Networks" };
const vendorShortName: VendorRecord = { id: "v-hp", name: "HP" };

const riskCve23: RiskRecord = {
  id: "r-001",
  title: "CVE-2023-20198 affects our network device fleet",
  description: "Cisco IOS XE vulnerability requiring immediate patching."
};

const riskCve44: RiskRecord = {
  id: "r-002",
  title: "Log4Shell remediation outstanding",
  description: "Multiple services still running CVE-2021-44228 versions of Log4j."
};

const riskNoMatch: RiskRecord = {
  id: "r-003",
  title: "Generic internal risk",
  description: "Internal process risk with no CVE."
};

const aiSystem: AiSystemRecord = { id: "ai-001", name: "GPT-4 Chatbot" };
const aiSystemClaude: AiSystemRecord = { id: "ai-002", name: "Claude" };

const obligationHIPAA: ObligationRecord = {
  id: "obl-001",
  title: "HIPAA Privacy Rule Compliance",
  description: null
};

const obligationNIST: ObligationRecord = {
  id: "obl-002",
  title: "NIST CSF 2.0 Framework Implementation",
  description: null
};

const obligationGDPR: ObligationRecord = {
  id: "obl-003",
  title: "GDPR Article 32 Technical Safeguards",
  description: null
};

// ====================================================================
// normalizeText
// ====================================================================

describe("normalizeText", () => {
  it("lowercases input", () => {
    expect(normalizeText("CISCO")).toBe("cisco");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeText("  a   b  ")).toBe("a b");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(normalizeText("")).toBe("");
  });
});

// ====================================================================
// nameAppearsIn
// ====================================================================

describe("nameAppearsIn", () => {
  it("returns true for exact case-insensitive match", () => {
    expect(nameAppearsIn("Critical Cisco vulnerability", "cisco")).toBe(true);
  });

  it("returns true for substring match (vendor in longer text)", () => {
    expect(nameAppearsIn("Palo Alto Networks advisory", "Palo Alto Networks")).toBe(true);
  });

  it("returns false when name not in haystack", () => {
    expect(nameAppearsIn("Microsoft Windows exploit", "Fortinet")).toBe(false);
  });

  it("returns false for names shorter than 3 characters", () => {
    // 'HP' (2 chars) should not match to avoid false positives like 'shape'
    expect(nameAppearsIn("Develop HTTP proxy", "HP")).toBe(false);
  });

  it("returns false for names exactly 2 characters", () => {
    expect(nameAppearsIn("IBM and HP products", "HP")).toBe(false);
  });

  it("returns true for names exactly 3 characters", () => {
    expect(nameAppearsIn("IBM advisory", "IBM")).toBe(true);
  });

  it("returns false when name is whitespace-only", () => {
    expect(nameAppearsIn("some text", "   ")).toBe(false);
  });
});

// ====================================================================
// extractCves
// ====================================================================

describe("extractCves", () => {
  it("extracts a single CVE ID", () => {
    const result = extractCves("This affects CVE-2021-44228 in Log4j");
    expect(result.has("CVE-2021-44228")).toBe(true);
  });

  it("extracts multiple CVE IDs", () => {
    const result = extractCves("CVE-2023-20198 and CVE-2021-44228 both apply");
    expect(result.has("CVE-2023-20198")).toBe(true);
    expect(result.has("CVE-2021-44228")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("normalises to uppercase", () => {
    const result = extractCves("vulnerability cve-2023-20198 is critical");
    expect(result.has("CVE-2023-20198")).toBe(true);
  });

  it("returns empty set when no CVE present", () => {
    expect(extractCves("No vulnerabilities here").size).toBe(0);
  });

  it("handles 4-digit CVE suffix", () => {
    const result = extractCves("CVE-2024-1234 is new");
    expect(result.has("CVE-2024-1234")).toBe(true);
  });
});

// ====================================================================
// extractObligationKeywords
// ====================================================================

describe("extractObligationKeywords", () => {
  it("extracts significant words from HIPAA title", () => {
    const kw = extractObligationKeywords("HIPAA Privacy Rule Compliance");
    expect(kw).toContain("hipaa");
    expect(kw).toContain("privacy");
    // 'compliance' is in stop words, not extracted
    expect(kw).not.toContain("compliance");
  });

  it("extracts NIST and csf from NIST CSF title", () => {
    const kw = extractObligationKeywords("NIST CSF 2.0 Framework Implementation");
    // 'nist' = 4 chars → filtered out (not > 4)
    // 'framework' is in stop words
    // 'implementation' > 4 chars and not in stop words
    expect(kw).toContain("implementation");
  });

  it("filters short words (≤4 chars)", () => {
    const kw = extractObligationKeywords("Rule and Data");
    // 'rule' = 4 chars, 'and' = 3, 'data' = 4 — all filtered
    expect(kw.length).toBe(0);
  });

  it("filters stop words", () => {
    const kw = extractObligationKeywords("Policy Standard Requirements Compliance");
    // 'policy', 'standard', 'requirements', 'compliance' all in stop words
    expect(kw.length).toBe(0);
  });

  it("handles empty string", () => {
    expect(extractObligationKeywords("")).toEqual([]);
  });
});

// ====================================================================
// matchVendors
// ====================================================================

describe("matchVendors — vendor matching", () => {
  it("matches via affected_vendor field", () => {
    const item = makeItem({ affected_vendor: "Cisco" });
    const matches = matchVendors(item, [vendorCisco, vendorFortinet]);
    expect(matches.map((v) => v.id)).toContain("v-cisco");
  });

  it("matches via title substring", () => {
    const item = makeItem({ affected_vendor: null });
    const matches = matchVendors(item, [vendorCisco]);
    // Title contains "Cisco IOS XE" → matches
    expect(matches.map((v) => v.id)).toContain("v-cisco");
  });

  it("matches via summary substring", () => {
    const item = makeItem({ affected_vendor: null, title: "Generic advisory" });
    const matches = matchVendors(item, [vendorCisco]);
    // Summary contains "Cisco IOS XE" → matches
    expect(matches.map((v) => v.id)).toContain("v-cisco");
  });

  it("returns multiple vendor matches", () => {
    const item = makeItem({
      title: "Cisco and Fortinet VPN devices vulnerable",
      affected_vendor: null
    });
    const matches = matchVendors(item, [vendorCisco, vendorFortinet, vendorPaloAlto]);
    const ids = matches.map((v) => v.id);
    expect(ids).toContain("v-cisco");
    expect(ids).toContain("v-fort");
    expect(ids).not.toContain("v-pa");
  });

  it("returns empty for no match", () => {
    const item = makeItem({ title: "Microsoft exploit", affected_vendor: "Microsoft" });
    const matches = matchVendors(item, [vendorFortinet, vendorPaloAlto]);
    expect(matches).toHaveLength(0);
  });

  it("does not match vendor names shorter than 3 chars", () => {
    const item = makeItem({ title: "HTTP shape HP devices", affected_vendor: null });
    const matches = matchVendors(item, [vendorShortName]);
    expect(matches).toHaveLength(0);
  });

  it("returns empty when vendors list is empty", () => {
    expect(matchVendors(makeItem(), [])).toHaveLength(0);
  });
});

// ====================================================================
// matchAiSystems
// ====================================================================

describe("matchAiSystems — AI system matching", () => {
  it("matches AI system name in title", () => {
    const item = makeItem({ title: "GPT-4 Chatbot model inversion attack" });
    const matches = matchAiSystems(item, [aiSystem, aiSystemClaude]);
    expect(matches.map((a) => a.id)).toContain("ai-001");
  });

  it("matches AI system name in affected_vendor", () => {
    const item = makeItem({ affected_vendor: "Claude" });
    const matches = matchAiSystems(item, [aiSystemClaude]);
    expect(matches.map((a) => a.id)).toContain("ai-002");
  });

  it("returns empty for no match", () => {
    const item = makeItem({ title: "Windows exploit", affected_vendor: "Microsoft" });
    expect(matchAiSystems(item, [aiSystem])).toHaveLength(0);
  });

  it("returns empty when ai_systems list is empty", () => {
    expect(matchAiSystems(makeItem(), [])).toHaveLength(0);
  });
});

// ====================================================================
// matchRisks
// ====================================================================

describe("matchRisks — CVE-keyed risk matching", () => {
  it("matches risk whose title mentions the item CVE", () => {
    const item = makeItem({ affected_cve: "CVE-2023-20198" });
    const matches = matchRisks(item, [riskCve23, riskCve44, riskNoMatch]);
    expect(matches.map((r) => r.id)).toContain("r-001");
    expect(matches.map((r) => r.id)).not.toContain("r-002");
    expect(matches.map((r) => r.id)).not.toContain("r-003");
  });

  it("matches risk whose description mentions the item CVE", () => {
    const item = makeItem({ affected_cve: "CVE-2021-44228" });
    const matches = matchRisks(item, [riskCve23, riskCve44]);
    expect(matches.map((r) => r.id)).toContain("r-002");
  });

  it("returns empty when item has no CVE", () => {
    const item = makeItem({ affected_cve: null });
    expect(matchRisks(item, [riskCve23])).toHaveLength(0);
  });

  it("returns empty when no risk mentions the CVE", () => {
    const item = makeItem({ affected_cve: "CVE-2099-99999" });
    expect(matchRisks(item, [riskCve23, riskCve44])).toHaveLength(0);
  });

  it("returns empty when risks list is empty", () => {
    expect(matchRisks(makeItem(), [])).toHaveLength(0);
  });

  it("is case-insensitive for CVE matching", () => {
    const riskLower: RiskRecord = {
      id: "r-lower",
      title: "Outstanding patch for cve-2023-20198",
      description: null
    };
    const item = makeItem({ affected_cve: "CVE-2023-20198" });
    const matches = matchRisks(item, [riskLower]);
    expect(matches).toHaveLength(1);
  });
});

// ====================================================================
// matchObligations
// ====================================================================

describe("matchObligations — regulatory keyword matching", () => {
  it("matches obligation by title keyword in regulatory item", () => {
    const item = makeItem({
      category: "regulatory",
      title: "HIPAA enforcement action against healthcare provider",
      summary: "HHS issues civil monetary penalty for HIPAA privacy violations.",
      affected_cve: null
    });
    const matches = matchObligations(item, [obligationHIPAA, obligationNIST]);
    expect(matches.map((o) => o.id)).toContain("obl-001");
  });

  it("returns empty for non-regulatory items regardless of keyword overlap", () => {
    const item = makeItem({
      category: "vulnerability",
      title: "HIPAA-related exploit in healthcare software",
      affected_cve: null
    });
    expect(matchObligations(item, [obligationHIPAA])).toHaveLength(0);
  });

  it("returns empty when obligations list is empty", () => {
    const item = makeItem({ category: "regulatory" });
    expect(matchObligations(item, [])).toHaveLength(0);
  });

  it("does not match when no meaningful keywords overlap", () => {
    const item = makeItem({
      category: "regulatory",
      title: "New data protection standards published",
      summary: "Regulatory agencies issue updated guidance."
    });
    // obligationGDPR has keyword 'technical' and 'safeguards' and 'article'
    // Item doesn't have 'technical' or 'safeguards'
    const matches = matchObligations(item, [obligationGDPR]);
    // 'technical' (9 chars, not stop word) — not in item text → no match
    expect(matches).toHaveLength(0);
  });
});

// ====================================================================
// personalizeItem
// ====================================================================

describe("personalizeItem — single item", () => {
  it("is_personalized = false and platform_context = null when no match", () => {
    const item = makeItem({ affected_cve: null, affected_vendor: "Oracle" });
    const result = personalizeItem(item, EMPTY_CONTEXT);
    expect(result.is_personalized).toBe(false);
    expect(result.platform_context).toBeNull();
  });

  it("is_personalized = true and platform_context populated on vendor match", () => {
    const item = makeItem({ affected_vendor: "Cisco" });
    const context: OrgPlatformContext = {
      vendors: [vendorCisco],
      risks: [],
      ai_systems: [],
      obligations: []
    };
    const result = personalizeItem(item, context);
    expect(result.is_personalized).toBe(true);
    expect(result.platform_context).not.toBeNull();
    expect(result.platform_context!.matched_vendors).toHaveLength(1);
    expect(result.platform_context!.matched_vendors[0]!.id).toBe("v-cisco");
    expect(result.platform_context!.matched_risks).toHaveLength(0);
    expect(result.platform_context!.matched_ai_systems).toHaveLength(0);
    expect(result.platform_context!.matched_obligations).toHaveLength(0);
  });

  it("is_personalized = true on risk CVE match", () => {
    const item = makeItem({ affected_cve: "CVE-2023-20198", affected_vendor: "Oracle" });
    const context: OrgPlatformContext = {
      vendors: [vendorFortinet],
      risks: [riskCve23],
      ai_systems: [],
      obligations: []
    };
    const result = personalizeItem(item, context);
    expect(result.is_personalized).toBe(true);
    expect(result.platform_context!.matched_risks).toHaveLength(1);
    expect(result.platform_context!.matched_vendors).toHaveLength(0);
  });

  it("is_personalized = true on AI system match", () => {
    const item = makeItem({ title: "GPT-4 Chatbot vulnerability", affected_vendor: null });
    const context: OrgPlatformContext = {
      vendors: [],
      risks: [],
      ai_systems: [aiSystem],
      obligations: []
    };
    const result = personalizeItem(item, context);
    expect(result.is_personalized).toBe(true);
    expect(result.platform_context!.matched_ai_systems).toHaveLength(1);
  });

  it("preserves all original BriefItem fields", () => {
    const item = makeItem();
    const result = personalizeItem(item, EMPTY_CONTEXT);
    expect(result.cyber_signal_id).toBe(item.cyber_signal_id);
    expect(result.title).toBe(item.title);
    expect(result.category).toBe(item.category);
    expect(result.sort_order).toBe(item.sort_order);
  });

  it("accumulates multiple match types in platform_context", () => {
    const item = makeItem({
      affected_vendor: "Cisco",
      affected_cve: "CVE-2023-20198"
    });
    const context: OrgPlatformContext = {
      vendors: [vendorCisco],
      risks: [riskCve23],
      ai_systems: [],
      obligations: []
    };
    const result = personalizeItem(item, context);
    expect(result.is_personalized).toBe(true);
    expect(result.platform_context!.matched_vendors).toHaveLength(1);
    expect(result.platform_context!.matched_risks).toHaveLength(1);
  });
});

// ====================================================================
// personalizeItems — batch
// ====================================================================

describe("personalizeItems — batch processing", () => {
  it("returns empty array for empty input", () => {
    expect(personalizeItems([], EMPTY_CONTEXT)).toHaveLength(0);
  });

  it("processes all items in batch", () => {
    const items = [
      makeItem({ affected_vendor: "Cisco" }),
      makeItem({ cyber_signal_id: "sig-002", title: "Fortinet SSL VPN vulnerability", summary: "Fortinet SSL VPN flaw.", affected_vendor: "Fortinet" }),
      makeItem({ cyber_signal_id: "sig-003", title: "Database privilege escalation", summary: "Generic DB issue.", affected_vendor: "Oracle", affected_cve: null })
    ];
    const context: OrgPlatformContext = {
      vendors: [vendorCisco, vendorFortinet],
      risks: [],
      ai_systems: [],
      obligations: []
    };
    const results = personalizeItems(items, context);
    expect(results).toHaveLength(3);
    expect(results[0]!.is_personalized).toBe(true);  // Cisco match
    expect(results[1]!.is_personalized).toBe(true);  // Fortinet match
    expect(results[2]!.is_personalized).toBe(false); // Oracle — no match
  });

  it("each result has is_personalized and platform_context", () => {
    const items = [makeItem()];
    const results = personalizeItems(items, EMPTY_CONTEXT);
    expect("is_personalized" in results[0]!).toBe(true);
    expect("platform_context" in results[0]!).toBe(true);
  });

  it("uses the same context for all items (no repeated fetches)", () => {
    const context: OrgPlatformContext = {
      vendors: [vendorCisco],
      risks: [riskCve23],
      ai_systems: [],
      obligations: []
    };
    const items = [
      makeItem({ cyber_signal_id: "a", affected_cve: "CVE-2023-20198" }),
      makeItem({ cyber_signal_id: "b", affected_cve: "CVE-2023-20198" })
    ];
    const results = personalizeItems(items, context);
    // Both should match the same risk
    expect(results[0]!.platform_context!.matched_risks[0]!.id).toBe("r-001");
    expect(results[1]!.platform_context!.matched_risks[0]!.id).toBe("r-001");
  });
});
