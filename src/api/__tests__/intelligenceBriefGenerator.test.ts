import { describe, it, expect } from "vitest";

import {
  mapSignalToCategory,
  scoreRelevance,
  buildBriefItems,
  buildContentJson,
  buildContentMarkdown,
  generateBrief,
  type CyberSignalForBrief,
  type BriefItem,
  type BriefContentJson
} from "../lib/intelligenceBriefGenerator.js";

// ====================================================================
// mapSignalToCategory
// ====================================================================

describe("mapSignalToCategory — vulnerability types", () => {
  it("maps 'cve' to vulnerability", () => {
    expect(mapSignalToCategory("cve")).toBe("vulnerability");
  });

  it("maps 'patch' to vulnerability", () => {
    expect(mapSignalToCategory("patch")).toBe("vulnerability");
  });

  it("maps 'advisory' to vulnerability", () => {
    expect(mapSignalToCategory("advisory")).toBe("vulnerability");
  });

  it("maps 'CVE' (uppercase) to vulnerability", () => {
    expect(mapSignalToCategory("CVE")).toBe("vulnerability");
  });
});

describe("mapSignalToCategory — threat_actor types", () => {
  it("maps 'threat_actor' to threat_actor", () => {
    expect(mapSignalToCategory("threat_actor")).toBe("threat_actor");
  });

  it("maps 'malware' to threat_actor", () => {
    expect(mapSignalToCategory("malware")).toBe("threat_actor");
  });

  it("maps 'geopolitical' to threat_actor", () => {
    expect(mapSignalToCategory("geopolitical")).toBe("threat_actor");
  });
});

describe("mapSignalToCategory — vendor_incident types", () => {
  it("maps 'breach' to vendor_incident", () => {
    expect(mapSignalToCategory("breach")).toBe("vendor_incident");
  });
});

describe("mapSignalToCategory — general fallback", () => {
  it("maps unknown type to general", () => {
    expect(mapSignalToCategory("unknown_type")).toBe("general");
  });

  it("maps empty string to general", () => {
    expect(mapSignalToCategory("")).toBe("general");
  });
});

// ====================================================================
// scoreRelevance
// ====================================================================

describe("scoreRelevance — Critical always high", () => {
  it("Critical with no CVE → high", () => {
    expect(scoreRelevance("Critical", null)).toBe("high");
  });

  it("Critical with CVE → high", () => {
    expect(scoreRelevance("Critical", "CVE-2024-12345")).toBe("high");
  });
});

describe("scoreRelevance — High severity", () => {
  it("High with CVE → high", () => {
    expect(scoreRelevance("High", "CVE-2024-12345")).toBe("high");
  });

  it("High without CVE → medium", () => {
    expect(scoreRelevance("High", null)).toBe("medium");
  });

  it("High with empty string CVE → medium", () => {
    expect(scoreRelevance("High", "")).toBe("medium");
  });
});

describe("scoreRelevance — Moderate severity", () => {
  it("Moderate with CVE → medium", () => {
    expect(scoreRelevance("Moderate", "CVE-2024-1")).toBe("medium");
  });

  it("Moderate without CVE → low", () => {
    expect(scoreRelevance("Moderate", null)).toBe("low");
  });
});

describe("scoreRelevance — Low severity", () => {
  it("Low without CVE → low", () => {
    expect(scoreRelevance("Low", null)).toBe("low");
  });

  it("Low with CVE → low", () => {
    expect(scoreRelevance("Low", "CVE-2024-999")).toBe("low");
  });
});

// ====================================================================
// buildBriefItems — empty input
// ====================================================================

describe("buildBriefItems — empty input", () => {
  it("returns empty array for empty input", () => {
    expect(buildBriefItems([])).toEqual([]);
  });
});

// ====================================================================
// buildBriefItems — field mapping
// ====================================================================

describe("buildBriefItems — field mapping", () => {
  const signal: CyberSignalForBrief = {
    id: "sig-1",
    signal_type: "cve",
    severity: "Critical",
    normalized_summary: "Remote code execution in OpenSSL",
    affected_cve: "CVE-2024-12345",
    affected_vendor: "OpenSSL",
    source: "cisa-kev",
    ingestion_timestamp: "2026-05-01T10:00:00.000Z"
  };

  it("maps cyber_signal_id correctly", () => {
    expect(buildBriefItems([signal])[0]!.cyber_signal_id).toBe("sig-1");
  });

  it("maps category correctly (cve → vulnerability)", () => {
    expect(buildBriefItems([signal])[0]!.category).toBe("vulnerability");
  });

  it("maps relevance correctly (Critical → high)", () => {
    expect(buildBriefItems([signal])[0]!.relevance).toBe("high");
  });

  it("maps title to summary when ≤ 80 chars", () => {
    expect(buildBriefItems([signal])[0]!.title).toBe("Remote code execution in OpenSSL");
  });

  it("maps summary correctly", () => {
    expect(buildBriefItems([signal])[0]!.summary).toBe("Remote code execution in OpenSSL");
  });

  it("maps affected_cve correctly", () => {
    expect(buildBriefItems([signal])[0]!.affected_cve).toBe("CVE-2024-12345");
  });

  it("maps affected_vendor correctly", () => {
    expect(buildBriefItems([signal])[0]!.affected_vendor).toBe("OpenSSL");
  });

  it("maps source_slug correctly", () => {
    expect(buildBriefItems([signal])[0]!.source_slug).toBe("cisa-kev");
  });

  it("maps signal_type correctly", () => {
    expect(buildBriefItems([signal])[0]!.signal_type).toBe("cve");
  });

  it("maps severity correctly", () => {
    expect(buildBriefItems([signal])[0]!.severity).toBe("Critical");
  });

  it("maps ingestion_timestamp correctly", () => {
    expect(buildBriefItems([signal])[0]!.ingestion_timestamp).toBe("2026-05-01T10:00:00.000Z");
  });

  it("assigns sort_order 0 for single item", () => {
    expect(buildBriefItems([signal])[0]!.sort_order).toBe(0);
  });
});

// ====================================================================
// buildBriefItems — title truncation
// ====================================================================

describe("buildBriefItems — title truncation", () => {
  it("truncates summary > 80 chars to 77 + '...'", () => {
    const longSummary = "A".repeat(100);
    const signal: CyberSignalForBrief = {
      id: "s",
      signal_type: "advisory",
      severity: "Low",
      normalized_summary: longSummary,
      affected_cve: null,
      affected_vendor: null,
      source: "nvd",
      ingestion_timestamp: "2026-05-01T00:00:00.000Z"
    };
    const title = buildBriefItems([signal])[0]!.title;
    expect(title.length).toBe(80);
    expect(title.endsWith("...")).toBe(true);
  });

  it("builds title from CVE + vendor + signal_type when summary is empty", () => {
    const signal: CyberSignalForBrief = {
      id: "s",
      signal_type: "cve",
      severity: "High",
      normalized_summary: "",
      affected_cve: "CVE-2024-1",
      affected_vendor: "Acme",
      source: "nvd",
      ingestion_timestamp: "2026-05-01T00:00:00.000Z"
    };
    const title = buildBriefItems([signal])[0]!.title;
    expect(title).toBe("CVE-2024-1 — Acme — CVE");
  });

  it("builds title from signal_type only when summary empty and no CVE/vendor", () => {
    const signal: CyberSignalForBrief = {
      id: "s",
      signal_type: "malware",
      severity: "Moderate",
      normalized_summary: "",
      affected_cve: null,
      affected_vendor: null,
      source: "rss",
      ingestion_timestamp: "2026-05-01T00:00:00.000Z"
    };
    const title = buildBriefItems([signal])[0]!.title;
    expect(title).toBe("MALWARE");
  });

  it("uses raw_payload.title when present and non-empty", () => {
    const signal: CyberSignalForBrief = {
      id: "s",
      signal_type: "advisory",
      severity: "Critical",
      normalized_summary: "View CSAF\nSummary\nSuccessful exploitation could allow a...",
      affected_cve: null,
      affected_vendor: null,
      source: "regulatory_cisa",
      ingestion_timestamp: "2026-05-01T00:00:00.000Z",
      raw_payload: { title: "ABB PCM600" }
    };
    const title = buildBriefItems([signal])[0]!.title;
    expect(title).toBe("ABB PCM600");
  });

  it("falls back to normalized_summary when raw_payload.title is missing", () => {
    const signal: CyberSignalForBrief = {
      id: "s",
      signal_type: "advisory",
      severity: "High",
      normalized_summary: "Real summary text here",
      affected_cve: null,
      affected_vendor: null,
      source: "rss",
      ingestion_timestamp: "2026-05-01T00:00:00.000Z",
      raw_payload: null
    };
    const title = buildBriefItems([signal])[0]!.title;
    expect(title).toBe("Real summary text here");
  });

  it("strips 'View CSAF Summary' boilerplate from normalized_summary fallback", () => {
    const signal: CyberSignalForBrief = {
      id: "s",
      signal_type: "advisory",
      severity: "Critical",
      normalized_summary: "View CSAF\nSummary\nSuccessful exploitation could allow remote code execution",
      affected_cve: null,
      affected_vendor: null,
      source: "regulatory_cisa",
      ingestion_timestamp: "2026-05-01T00:00:00.000Z",
      raw_payload: null
    };
    const title = buildBriefItems([signal])[0]!.title;
    expect(title.startsWith("View CSAF")).toBe(false);
    expect(title.startsWith("Summary")).toBe(false);
    expect(title.startsWith("Successful exploitation")).toBe(true);
  });

  it("falls back when raw_payload.title is whitespace-only", () => {
    const signal: CyberSignalForBrief = {
      id: "s",
      signal_type: "advisory",
      severity: "High",
      normalized_summary: "Actual summary",
      affected_cve: null,
      affected_vendor: null,
      source: "rss",
      ingestion_timestamp: "2026-05-01T00:00:00.000Z",
      raw_payload: { title: "   " }
    };
    const title = buildBriefItems([signal])[0]!.title;
    expect(title).toBe("Actual summary");
  });
});

// ====================================================================
// buildBriefItems — sort order
// ====================================================================

describe("buildBriefItems — sort order", () => {
  const makeSignal = (
    id: string,
    severity: string,
    cve: string | null,
    ts: string
  ): CyberSignalForBrief => ({
    id,
    signal_type: "cve",
    severity,
    normalized_summary: `Signal ${id}`,
    affected_cve: cve,
    affected_vendor: null,
    source: "nvd",
    ingestion_timestamp: ts
  });

  const signals: CyberSignalForBrief[] = [
    makeSignal("low-old", "Low", null, "2026-04-25T00:00:00.000Z"),
    makeSignal("high-new", "Critical", null, "2026-05-01T10:00:00.000Z"),
    makeSignal("medium-mid", "High", null, "2026-04-28T00:00:00.000Z"),
    makeSignal("high-old", "Critical", null, "2026-04-26T00:00:00.000Z")
  ];

  it("sorts high relevance items before medium", () => {
    const items = buildBriefItems(signals);
    const highIdx = items.findIndex((i) => i.relevance === "high");
    const medIdx = items.findIndex((i) => i.relevance === "medium");
    expect(highIdx).toBeLessThan(medIdx);
  });

  it("sorts medium before low", () => {
    const items = buildBriefItems(signals);
    const medIdx = items.findIndex((i) => i.relevance === "medium");
    const lowIdx = items.findIndex((i) => i.relevance === "low");
    expect(medIdx).toBeLessThan(lowIdx);
  });

  it("within same relevance tier, sorts by ingestion_timestamp DESC", () => {
    const items = buildBriefItems(signals);
    const highItems = items.filter((i) => i.relevance === "high");
    expect(highItems[0]!.cyber_signal_id).toBe("high-new");
    expect(highItems[1]!.cyber_signal_id).toBe("high-old");
  });

  it("assigns contiguous sort_order starting at 0", () => {
    const items = buildBriefItems(signals);
    items.forEach((item, idx) => {
      expect(item.sort_order).toBe(idx);
    });
  });

  it("returns correct item count", () => {
    expect(buildBriefItems(signals).length).toBe(4);
  });
});

// ====================================================================
// buildContentJson
// ====================================================================

describe("buildContentJson — basic fields", () => {
  const items: BriefItem[] = [
    {
      cyber_signal_id: "s1",
      category: "vulnerability",
      relevance: "high",
      title: "High vuln",
      summary: "desc",
      affected_cve: "CVE-2024-1",
      affected_vendor: null,
      source_slug: "cisa-kev",
      signal_type: "cve",
      severity: "Critical",
      ingestion_timestamp: "2026-05-01T00:00:00.000Z",
      sort_order: 0
    },
    {
      cyber_signal_id: "s2",
      category: "threat_actor",
      relevance: "medium",
      title: "Medium threat",
      summary: "threat desc",
      affected_cve: null,
      affected_vendor: "Acme",
      source_slug: "nvd",
      signal_type: "malware",
      severity: "High",
      ingestion_timestamp: "2026-04-30T00:00:00.000Z",
      sort_order: 1
    },
    {
      cyber_signal_id: "s3",
      category: "vulnerability",
      relevance: "low",
      title: "Low vuln",
      summary: "low desc",
      affected_cve: null,
      affected_vendor: null,
      source_slug: "rss",
      signal_type: "advisory",
      severity: "Low",
      ingestion_timestamp: "2026-04-29T00:00:00.000Z",
      sort_order: 2
    }
  ];

  const content = buildContentJson(items, "2026-04-24T00:00:00.000Z", "2026-05-01T00:00:00.000Z", 5);

  it("sets period_start correctly", () => {
    expect(content.period_start).toBe("2026-04-24T00:00:00.000Z");
  });

  it("sets period_end correctly", () => {
    expect(content.period_end).toBe("2026-05-01T00:00:00.000Z");
  });

  it("sets signal_count to provided value", () => {
    expect(content.signal_count).toBe(5);
  });

  it("sets item_count to items array length", () => {
    expect(content.item_count).toBe(3);
  });

  it("counts high relevance items correctly", () => {
    expect(content.high_count).toBe(1);
  });

  it("counts medium relevance items correctly", () => {
    expect(content.medium_count).toBe(1);
  });

  it("counts low relevance items correctly", () => {
    expect(content.low_count).toBe(1);
  });

  it("groups items into categories — only non-empty categories", () => {
    const cats = content.categories.map((c) => c.category);
    expect(cats).toContain("vulnerability");
    expect(cats).toContain("threat_actor");
    expect(cats).not.toContain("vendor_incident");
    expect(cats).not.toContain("general");
  });

  it("vulnerability category has correct label", () => {
    const vulnCat = content.categories.find((c) => c.category === "vulnerability")!;
    expect(vulnCat.label).toBe("Vulnerabilities & Patches");
  });

  it("threat_actor category has correct label", () => {
    const taCat = content.categories.find((c) => c.category === "threat_actor")!;
    expect(taCat.label).toBe("Threat Actors & Malware");
  });

  it("vulnerability category has 2 items", () => {
    const vulnCat = content.categories.find((c) => c.category === "vulnerability")!;
    expect(vulnCat.items.length).toBe(2);
  });

  it("vulnerability appears before threat_actor in category order", () => {
    const cats = content.categories.map((c) => c.category);
    expect(cats.indexOf("vulnerability")).toBeLessThan(cats.indexOf("threat_actor"));
  });
});

describe("buildContentJson — empty items", () => {
  it("produces empty categories array for no items", () => {
    const content = buildContentJson([], "2026-04-24T00:00:00.000Z", "2026-05-01T00:00:00.000Z", 0);
    expect(content.categories).toEqual([]);
    expect(content.item_count).toBe(0);
    expect(content.signal_count).toBe(0);
    expect(content.high_count).toBe(0);
    expect(content.medium_count).toBe(0);
    expect(content.low_count).toBe(0);
  });
});

// ====================================================================
// buildContentMarkdown
// ====================================================================

describe("buildContentMarkdown — structure", () => {
  const content: BriefContentJson = {
    period_start: "2026-04-24T00:00:00.000Z",
    period_end: "2026-05-01T00:00:00.000Z",
    signal_count: 3,
    item_count: 2,
    high_count: 1,
    medium_count: 1,
    low_count: 0,
    categories: [
      {
        category: "vulnerability",
        label: "Vulnerabilities & Patches",
        items: [
          {
            cyber_signal_id: "s1",
            category: "vulnerability",
            relevance: "high",
            title: "Critical OpenSSL flaw",
            summary: "Remote code execution in OpenSSL 3.x",
            affected_cve: "CVE-2024-12345",
            affected_vendor: "OpenSSL",
            source_slug: "cisa-kev",
            signal_type: "cve",
            severity: "Critical",
            ingestion_timestamp: "2026-05-01T00:00:00.000Z",
            sort_order: 0
          }
        ]
      },
      {
        category: "threat_actor",
        label: "Threat Actors & Malware",
        items: [
          {
            cyber_signal_id: "s2",
            category: "threat_actor",
            relevance: "medium",
            title: "New ransomware campaign",
            summary: "RansomX targeting healthcare sector",
            affected_cve: null,
            affected_vendor: null,
            source_slug: "rss",
            signal_type: "malware",
            severity: "High",
            ingestion_timestamp: "2026-04-30T00:00:00.000Z",
            sort_order: 1
          }
        ]
      }
    ]
  };

  const md = buildContentMarkdown(content);

  it("starts with the Intelligence Brief heading", () => {
    expect(md).toContain("# SecureLogic AI — Intelligence Brief");
  });

  it("includes the period", () => {
    expect(md).toContain("2026-04-24T00:00:00.000Z");
    expect(md).toContain("2026-05-01T00:00:00.000Z");
  });

  it("includes signal count", () => {
    expect(md).toContain("Signals processed:** 3");
  });

  it("includes high count", () => {
    expect(md).toContain("High relevance:** 1");
  });

  it("includes medium count", () => {
    expect(md).toContain("Medium:** 1");
  });

  it("includes vulnerability category heading", () => {
    expect(md).toContain("## Vulnerabilities & Patches");
  });

  it("includes threat actor category heading", () => {
    expect(md).toContain("## Threat Actors & Malware");
  });

  it("includes item title with HIGH badge", () => {
    expect(md).toContain("### [HIGH] Critical OpenSSL flaw");
  });

  it("includes item title with MEDIUM badge", () => {
    expect(md).toContain("### [MEDIUM] New ransomware campaign");
  });

  it("includes CVE in metadata", () => {
    expect(md).toContain("CVE: CVE-2024-12345");
  });

  it("includes vendor in metadata", () => {
    expect(md).toContain("Vendor: OpenSSL");
  });

  it("includes source in metadata", () => {
    expect(md).toContain("Source: cisa-kev");
  });

  it("includes severity in metadata", () => {
    expect(md).toContain("Severity: Critical");
  });
});

describe("buildContentMarkdown — empty brief", () => {
  it("still includes heading for empty brief", () => {
    const content: BriefContentJson = {
      period_start: "2026-04-24T00:00:00.000Z",
      period_end: "2026-05-01T00:00:00.000Z",
      signal_count: 0,
      item_count: 0,
      high_count: 0,
      medium_count: 0,
      low_count: 0,
      categories: []
    };
    const md = buildContentMarkdown(content);
    expect(md).toContain("# SecureLogic AI — Intelligence Brief");
    expect(md).toContain("Signals processed:** 0");
  });
});

// ====================================================================
// generateBrief — integration of all pure functions
// ====================================================================

describe("generateBrief — empty signals", () => {
  it("returns empty items for no signals", () => {
    const result = generateBrief([], "2026-04-24T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    expect(result.items).toEqual([]);
    expect(result.signal_count).toBe(0);
    expect(result.item_count).toBe(0);
  });

  it("content_json has empty categories", () => {
    const result = generateBrief([], "2026-04-24T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    expect(result.content_json.categories).toEqual([]);
  });
});

describe("generateBrief — field propagation", () => {
  const signals: CyberSignalForBrief[] = [
    {
      id: "sig-crit",
      signal_type: "cve",
      severity: "Critical",
      normalized_summary: "Critical vuln in nginx",
      affected_cve: "CVE-2024-9999",
      affected_vendor: "nginx",
      source: "nvd",
      ingestion_timestamp: "2026-05-01T09:00:00.000Z"
    },
    {
      id: "sig-breach",
      signal_type: "breach",
      severity: "High",
      normalized_summary: "Major data breach at CloudVendor",
      affected_cve: null,
      affected_vendor: "CloudVendor",
      source: "rss",
      ingestion_timestamp: "2026-04-30T15:00:00.000Z"
    },
    {
      id: "sig-geo",
      signal_type: "geopolitical",
      severity: "Moderate",
      normalized_summary: "Increased activity in region X",
      affected_cve: null,
      affected_vendor: null,
      source: "manual",
      ingestion_timestamp: "2026-04-29T00:00:00.000Z"
    }
  ];

  const result = generateBrief(signals, "2026-04-24T00:00:00.000Z", "2026-05-01T00:00:00.000Z");

  it("signal_count equals input signals length", () => {
    expect(result.signal_count).toBe(3);
  });

  it("item_count equals items array length", () => {
    expect(result.item_count).toBe(result.items.length);
  });

  it("produces 3 items from 3 signals", () => {
    expect(result.items.length).toBe(3);
  });

  it("content_json signal_count matches", () => {
    expect(result.content_json.signal_count).toBe(3);
  });

  it("content_json item_count matches", () => {
    expect(result.content_json.item_count).toBe(3);
  });

  it("content_markdown is non-empty string", () => {
    expect(typeof result.content_markdown).toBe("string");
    expect(result.content_markdown.length).toBeGreaterThan(0);
  });

  it("Critical CVE signal maps to vulnerability category", () => {
    const item = result.items.find((i) => i.cyber_signal_id === "sig-crit")!;
    expect(item.category).toBe("vulnerability");
  });

  it("breach signal maps to vendor_incident category", () => {
    const item = result.items.find((i) => i.cyber_signal_id === "sig-breach")!;
    expect(item.category).toBe("vendor_incident");
  });

  it("geopolitical signal maps to threat_actor category", () => {
    const item = result.items.find((i) => i.cyber_signal_id === "sig-geo")!;
    expect(item.category).toBe("threat_actor");
  });

  it("Critical signal has high relevance", () => {
    const item = result.items.find((i) => i.cyber_signal_id === "sig-crit")!;
    expect(item.relevance).toBe("high");
  });

  it("High breach (no CVE) has medium relevance", () => {
    const item = result.items.find((i) => i.cyber_signal_id === "sig-breach")!;
    expect(item.relevance).toBe("medium");
  });

  it("Moderate geopolitical (no CVE) has low relevance", () => {
    const item = result.items.find((i) => i.cyber_signal_id === "sig-geo")!;
    expect(item.relevance).toBe("low");
  });

  it("high relevance item has lower sort_order than low relevance item", () => {
    const highItem = result.items.find((i) => i.cyber_signal_id === "sig-crit")!;
    const lowItem = result.items.find((i) => i.cyber_signal_id === "sig-geo")!;
    expect(highItem.sort_order).toBeLessThan(lowItem.sort_order);
  });

  it("content_markdown includes the brief heading", () => {
    expect(result.content_markdown).toContain("# SecureLogic AI — Intelligence Brief");
  });
});
