import { describe, it, expect, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import {
  filterItemsByPreferences,
  SEVERITY_RANK
} from "../lib/briefEmailSender.js";

// ---------------------------------------------------------------------------
// Fixtures — BriefItemRow shape (only fields used by filterItemsByPreferences)
// ---------------------------------------------------------------------------

function makeItem(
  severity: string,
  category: string,
  is_personalized = false
): {
  id: string;
  category: string;
  title: string;
  summary: string;
  severity: string;
  relevance: string;
  affected_cve: string | null;
  sort_order: string;
  why_it_matters: string | null;
  recommended_actions: string | null;
  is_personalized: boolean;
} {
  return {
    id: `item-${severity}-${category}`,
    category,
    title: `${severity} ${category} item`,
    summary: "Test summary.",
    severity,
    relevance: "high",
    affected_cve: null,
    sort_order: "0",
    why_it_matters: null,
    recommended_actions: null,
    is_personalized
  };
}

const itemCritical = makeItem("Critical", "vulnerability");
const itemHigh = makeItem("High", "threat_actor");
const itemModerate = makeItem("Moderate", "vendor_incident");
const itemLow = makeItem("Low", "general");
const itemRegulatoryHigh = makeItem("High", "regulatory");
const itemPersonalizedCritical = makeItem("Critical", "vulnerability", true);
const itemPersonalizedModerate = makeItem("Moderate", "vulnerability", true);

const ALL_ITEMS = [
  itemCritical,
  itemHigh,
  itemModerate,
  itemLow,
  itemRegulatoryHigh
];

// ====================================================================
// SEVERITY_RANK export sanity
// ====================================================================

describe("SEVERITY_RANK", () => {
  it("Critical > High > Moderate > Low", () => {
    expect(SEVERITY_RANK["Critical"]).toBeGreaterThan(SEVERITY_RANK["High"]!);
    expect(SEVERITY_RANK["High"]).toBeGreaterThan(SEVERITY_RANK["Moderate"]!);
    expect(SEVERITY_RANK["Moderate"]).toBeGreaterThan(SEVERITY_RANK["Low"]!);
  });

  it("has all four severity levels defined", () => {
    expect(SEVERITY_RANK["Critical"]).toBeDefined();
    expect(SEVERITY_RANK["High"]).toBeDefined();
    expect(SEVERITY_RANK["Moderate"]).toBeDefined();
    expect(SEVERITY_RANK["Low"]).toBeDefined();
  });
});

// ====================================================================
// min_severity filtering
// ====================================================================

describe("filterItemsByPreferences — min_severity", () => {
  it("Low (default) passes all items through", () => {
    const result = filterItemsByPreferences(ALL_ITEMS, {
      min_severity: "Low",
      categories: null,
      notify_vendor_matches_only: false
    });
    expect(result).toHaveLength(ALL_ITEMS.length);
  });

  it("Moderate excludes Low items only", () => {
    const result = filterItemsByPreferences(ALL_ITEMS, {
      min_severity: "Moderate",
      categories: null,
      notify_vendor_matches_only: false
    });
    expect(result.some((i) => i.severity === "Low")).toBe(false);
    expect(result.some((i) => i.severity === "Moderate")).toBe(true);
    expect(result.some((i) => i.severity === "High")).toBe(true);
    expect(result.some((i) => i.severity === "Critical")).toBe(true);
  });

  it("High excludes Moderate and Low items", () => {
    const result = filterItemsByPreferences(ALL_ITEMS, {
      min_severity: "High",
      categories: null,
      notify_vendor_matches_only: false
    });
    expect(result.some((i) => i.severity === "Low")).toBe(false);
    expect(result.some((i) => i.severity === "Moderate")).toBe(false);
    expect(result.some((i) => i.severity === "High")).toBe(true);
    expect(result.some((i) => i.severity === "Critical")).toBe(true);
  });

  it("Critical passes only Critical items", () => {
    const result = filterItemsByPreferences(ALL_ITEMS, {
      min_severity: "Critical",
      categories: null,
      notify_vendor_matches_only: false
    });
    expect(result.every((i) => i.severity === "Critical")).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("returns empty array when no items meet min_severity threshold", () => {
    const onlyLow = [makeItem("Low", "general"), makeItem("Low", "vulnerability")];
    const result = filterItemsByPreferences(onlyLow, {
      min_severity: "Critical",
      categories: null,
      notify_vendor_matches_only: false
    });
    expect(result).toHaveLength(0);
  });

  it("treats unknown severity as Low rank (rank 1)", () => {
    const unknownItem = makeItem("Unknown", "general");
    const result = filterItemsByPreferences([unknownItem], {
      min_severity: "Moderate",
      categories: null,
      notify_vendor_matches_only: false
    });
    // Unknown maps to 1 (< Moderate rank 2) → filtered out
    expect(result).toHaveLength(0);
  });
});

// ====================================================================
// categories filtering
// ====================================================================

describe("filterItemsByPreferences — categories", () => {
  it("null categories (default) passes all categories through", () => {
    const result = filterItemsByPreferences(ALL_ITEMS, {
      min_severity: "Low",
      categories: null,
      notify_vendor_matches_only: false
    });
    expect(result).toHaveLength(ALL_ITEMS.length);
  });

  it("allowlist of one category filters to only that category", () => {
    const result = filterItemsByPreferences(ALL_ITEMS, {
      min_severity: "Low",
      categories: ["vulnerability"],
      notify_vendor_matches_only: false
    });
    expect(result.every((i) => i.category === "vulnerability")).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("allowlist of two categories passes only those categories", () => {
    const result = filterItemsByPreferences(ALL_ITEMS, {
      min_severity: "Low",
      categories: ["vulnerability", "threat_actor"],
      notify_vendor_matches_only: false
    });
    const categories = result.map((i) => i.category);
    expect(categories).toContain("vulnerability");
    expect(categories).toContain("threat_actor");
    expect(categories).not.toContain("vendor_incident");
    expect(categories).not.toContain("general");
    expect(categories).not.toContain("regulatory");
  });

  it("allowlist that matches no items returns empty array", () => {
    const result = filterItemsByPreferences(ALL_ITEMS, {
      min_severity: "Low",
      categories: ["regulatory"],
      notify_vendor_matches_only: false
    });
    expect(result.every((i) => i.category === "regulatory")).toBe(true);
    expect(result).toHaveLength(1);
  });
});

// ====================================================================
// notify_vendor_matches_only filtering
// ====================================================================

describe("filterItemsByPreferences — notify_vendor_matches_only", () => {
  it("false (default) passes personalized and non-personalized items", () => {
    const items = [itemPersonalizedCritical, itemCritical, itemPersonalizedModerate];
    const result = filterItemsByPreferences(items, {
      min_severity: "Low",
      categories: null,
      notify_vendor_matches_only: false
    });
    expect(result).toHaveLength(3);
  });

  it("true keeps only is_personalized = true items", () => {
    const items = [itemPersonalizedCritical, itemCritical, itemPersonalizedModerate, itemHigh];
    const result = filterItemsByPreferences(items, {
      min_severity: "Low",
      categories: null,
      notify_vendor_matches_only: true
    });
    expect(result.every((i) => i.is_personalized)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("true with no personalized items returns empty array", () => {
    const items = [itemCritical, itemHigh, itemModerate];
    const result = filterItemsByPreferences(items, {
      min_severity: "Low",
      categories: null,
      notify_vendor_matches_only: true
    });
    expect(result).toHaveLength(0);
  });
});

// ====================================================================
// Combined preference filtering
// ====================================================================

describe("filterItemsByPreferences — combined preferences", () => {
  it("applies all three filters conjunctively", () => {
    const items = [
      itemPersonalizedCritical,          // Critical, vulnerability, personalized
      makeItem("High", "vulnerability", true),  // High, vulnerability, personalized
      makeItem("High", "general", true),         // High, general, personalized — wrong category
      makeItem("Moderate", "vulnerability", true), // Moderate, vulnerability, personalized — below threshold
      makeItem("Critical", "vulnerability", false) // Critical, vulnerability, NOT personalized
    ];

    const result = filterItemsByPreferences(items, {
      min_severity: "High",
      categories: ["vulnerability"],
      notify_vendor_matches_only: true
    });

    // Must be: severity >= High AND category = vulnerability AND is_personalized = true
    expect(result.every((i) => i.severity === "High" || i.severity === "Critical")).toBe(true);
    expect(result.every((i) => i.category === "vulnerability")).toBe(true);
    expect(result.every((i) => i.is_personalized)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("returns empty array when all items fail one filter", () => {
    // All items are personalized, right category, but all Low severity
    const items = [
      makeItem("Low", "vulnerability", true),
      makeItem("Low", "vulnerability", true)
    ];
    const result = filterItemsByPreferences(items, {
      min_severity: "High",
      categories: ["vulnerability"],
      notify_vendor_matches_only: true
    });
    expect(result).toHaveLength(0);
  });

  it("empty input always returns empty output", () => {
    const result = filterItemsByPreferences([], {
      min_severity: "High",
      categories: ["vulnerability"],
      notify_vendor_matches_only: true
    });
    expect(result).toHaveLength(0);
  });

  it("High min_severity + vendor_matches_only passes only High+ personalized", () => {
    const items = [
      makeItem("Critical", "general", true),
      makeItem("High", "threat_actor", true),
      makeItem("Moderate", "vulnerability", true), // fails severity
      makeItem("High", "vendor_incident", false)   // fails notify_vendor_matches_only
    ];
    const result = filterItemsByPreferences(items, {
      min_severity: "High",
      categories: null,
      notify_vendor_matches_only: true
    });
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.is_personalized)).toBe(true);
    expect(result.every((i) => (SEVERITY_RANK[i.severity] ?? 1) >= SEVERITY_RANK["High"]!)).toBe(true);
  });
});
