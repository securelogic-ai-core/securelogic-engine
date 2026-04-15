/**
 * threatIntelRssAdapter.test.ts — Unit tests for threat intel RSS adapter.
 *
 * All tests are pure — no I/O, no network, no DB.
 * Tests cover: signal_type keyword routing, severity escalation rules,
 * vendor name matching from lookup list, CVE extraction, summary building,
 * and the mapRssItemToSignal pipeline.
 */

import { describe, it, expect } from "vitest";
import {
  deriveRssSignalType,
  deriveRssSeverity,
  extractRssVendor,
  extractRssCve,
  buildRssNormalizedSummary,
  mapRssItemToSignal,
  KNOWN_VENDORS,
  type RssFeedItem
} from "../lib/threatIntelRssAdapter.js";

// ---------------------------------------------------------------------------
// deriveRssSignalType
// ---------------------------------------------------------------------------

describe("deriveRssSignalType", () => {
  describe("third_party_breach detection", () => {
    it("returns third_party_breach for 'breach' in title", () => {
      expect(deriveRssSignalType("MOVEit Breach Exposes 200 Organizations")).toBe("third_party_breach");
    });

    it("returns third_party_breach for 'hacked' in title", () => {
      expect(deriveRssSignalType("Okta Hacked: Customer Data Compromised")).toBe("third_party_breach");
    });

    it("returns third_party_breach for 'compromised' in title", () => {
      expect(deriveRssSignalType("SolarWinds Build System Compromised by Attackers")).toBe("third_party_breach");
    });
  });

  describe("threat_actor detection", () => {
    it("returns threat_actor for 'ransomware' in title", () => {
      expect(deriveRssSignalType("LockBit Ransomware Gang Claims Attack on Boeing")).toBe("threat_actor");
    });

    it("returns threat_actor for 'apt' in title", () => {
      expect(deriveRssSignalType("APT29 Using New Malware Variant in Espionage Campaign")).toBe("threat_actor");
    });

    it("returns threat_actor for 'threat actor' in title", () => {
      expect(deriveRssSignalType("Threat Actor Deploys Novel Backdoor Against Financial Sector")).toBe("threat_actor");
    });
  });

  describe("regulatory_change detection", () => {
    it("returns regulatory_change for 'regulation' in title", () => {
      expect(deriveRssSignalType("EU Cyber Resilience Act Regulation Takes Effect")).toBe("regulatory_change");
    });

    it("returns regulatory_change for 'compliance' in title", () => {
      expect(deriveRssSignalType("New HIPAA Compliance Requirements for AI Systems")).toBe("regulatory_change");
    });
  });

  describe("patch_advisory detection", () => {
    it("returns patch_advisory for 'patch' in title", () => {
      expect(deriveRssSignalType("Microsoft Patch Tuesday Fixes 80 Vulnerabilities")).toBe("patch_advisory");
    });

    it("returns patch_advisory for 'advisory' in title", () => {
      expect(deriveRssSignalType("Cisco Releases Security Advisory for IOS XE")).toBe("patch_advisory");
    });

    it("returns patch_advisory for 'update' in title", () => {
      expect(deriveRssSignalType("Apple Releases Emergency Update for iOS Zero-Day")).toBe("patch_advisory");
    });
  });

  describe("default fallback", () => {
    it("returns patch_advisory as default", () => {
      expect(deriveRssSignalType("Interesting Security Story With No Clear Category")).toBe("patch_advisory");
    });
  });

  it("is case-insensitive", () => {
    expect(deriveRssSignalType("RANSOMWARE HITS HOSPITAL")).toBe("threat_actor");
    expect(deriveRssSignalType("DATA BREACH AT BANK")).toBe("third_party_breach");
  });

  describe("priority ordering", () => {
    it("prefers third_party_breach over threat_actor when both keywords present", () => {
      // 'breach' is checked before 'ransomware' in the implementation
      expect(deriveRssSignalType("Ransomware Breach Exposes Customer Records")).toBe("third_party_breach");
    });

    it("prefers threat_actor over regulatory_change when both keywords present", () => {
      expect(deriveRssSignalType("Ransomware Compliance Requirements")).toBe("threat_actor");
    });
  });
});

// ---------------------------------------------------------------------------
// deriveRssSeverity
// ---------------------------------------------------------------------------

describe("deriveRssSeverity", () => {
  describe("Critical escalation", () => {
    it("returns Critical for 'zero-day' in title", () => {
      expect(deriveRssSeverity("Zero-Day Exploit Actively Used Against Windows Users")).toBe("Critical");
    });

    it("returns Critical for 'zero day' (no hyphen)", () => {
      expect(deriveRssSeverity("Zero Day Found in Popular VPN Software")).toBe("Critical");
    });

    it("returns Critical for 'actively exploited'", () => {
      expect(deriveRssSeverity("Actively Exploited Ivanti Flaw Added to CISA KEV")).toBe("Critical");
    });

    it("returns Critical for 'nation-state'", () => {
      expect(deriveRssSeverity("Nation-State Actors Target Energy Sector ICS Systems")).toBe("Critical");
    });

    it("returns Critical for 'nation state' (no hyphen)", () => {
      expect(deriveRssSeverity("Nation State Group Uses Novel Living-Off-the-Land Technique")).toBe("Critical");
    });
  });

  describe("High escalation", () => {
    it("returns High for 'critical' in title", () => {
      expect(deriveRssSeverity("Critical RCE Flaw Discovered in Apache Struts")).toBe("High");
    });

    it("returns High for 'breach' in title", () => {
      expect(deriveRssSeverity("Healthcare Giant Reports Major Data Breach")).toBe("High");
    });

    it("returns High for 'ransomware' in title", () => {
      expect(deriveRssSeverity("Ransomware Group Claims Attack on City Government")).toBe("High");
    });
  });

  describe("Moderate default", () => {
    it("returns Moderate by default", () => {
      expect(deriveRssSeverity("New Patch Tuesday Fixes Several Vulnerabilities")).toBe("Moderate");
    });

    it("returns Moderate for general security news", () => {
      expect(deriveRssSeverity("SANS ISC: Interesting Network Traffic Analysis")).toBe("Moderate");
    });
  });

  describe("Critical takes priority over High", () => {
    it("returns Critical for 'actively exploited critical' (Critical check first)", () => {
      expect(deriveRssSeverity("Actively Exploited Critical Vulnerability in Cisco")).toBe("Critical");
    });
  });

  it("is case-insensitive", () => {
    expect(deriveRssSeverity("ZERO-DAY IN WINDOWS")).toBe("Critical");
    expect(deriveRssSeverity("CRITICAL FLAW FOUND")).toBe("High");
    expect(deriveRssSeverity("RANSOMWARE HITS HOSPITAL")).toBe("High");
  });
});

// ---------------------------------------------------------------------------
// extractRssVendor
// ---------------------------------------------------------------------------

describe("extractRssVendor", () => {
  it("matches Microsoft", () => {
    expect(extractRssVendor("Microsoft Patches 80 Vulnerabilities in July Patch Tuesday")).toBe("Microsoft");
  });

  it("matches CrowdStrike", () => {
    expect(extractRssVendor("CrowdStrike Update Causes Global Windows Outage")).toBe("CrowdStrike");
  });

  it("matches Okta", () => {
    expect(extractRssVendor("Okta Support System Breach Exposes Customer Data")).toBe("Okta");
  });

  it("matches MOVEit", () => {
    expect(extractRssVendor("MOVEit Transfer Vulnerability Exploited by Cl0p Ransomware")).toBe("MOVEit");
  });

  it("matches GitLab", () => {
    expect(extractRssVendor("GitLab Patches Critical Account Takeover Vulnerability")).toBe("GitLab");
  });

  it("matches Atlassian", () => {
    expect(extractRssVendor("Atlassian Confluence Zero-Day Under Active Exploitation")).toBe("Atlassian");
  });

  it("returns null when no known vendor found", () => {
    expect(extractRssVendor("Unknown Vendor Patches Remote Code Execution Flaw")).toBeNull();
  });

  it("returns null for generic attack story", () => {
    expect(extractRssVendor("Threat Actor Targets Financial Sector with Phishing")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(extractRssVendor("MICROSOFT PATCHES WINDOWS")).toBe("Microsoft");
    expect(extractRssVendor("cisco advisory released")).toBe("Cisco");
  });

  it("KNOWN_VENDORS list contains expected vendors", () => {
    expect(KNOWN_VENDORS).toContain("Microsoft");
    expect(KNOWN_VENDORS).toContain("CrowdStrike");
    expect(KNOWN_VENDORS).toContain("Okta");
    expect(KNOWN_VENDORS).toContain("Ivanti");
    expect(KNOWN_VENDORS).toContain("SolarWinds");
  });
});

// ---------------------------------------------------------------------------
// extractRssCve
// ---------------------------------------------------------------------------

describe("extractRssCve", () => {
  it("extracts a CVE ID from text", () => {
    expect(extractRssCve("Exploiting CVE-2024-3400 in Palo Alto GlobalProtect")).toBe("CVE-2024-3400");
  });

  it("normalizes to uppercase", () => {
    expect(extractRssCve("cve-2023-44487 caused http/2 rapid reset attack")).toBe("CVE-2023-44487");
  });

  it("returns null when no CVE present", () => {
    expect(extractRssCve("No CVE mentioned in this article about security.")).toBeNull();
  });

  it("handles combined title+description search text", () => {
    const searchText = "Microsoft Patches RCE — Description mentions CVE-2024-12345 as affected.";
    expect(extractRssCve(searchText)).toBe("CVE-2024-12345");
  });
});

// ---------------------------------------------------------------------------
// buildRssNormalizedSummary
// ---------------------------------------------------------------------------

describe("buildRssNormalizedSummary", () => {
  it("uses title only when description is null", () => {
    expect(buildRssNormalizedSummary("Article Title", null)).toBe("Article Title");
  });

  it("combines title and truncated description", () => {
    const result = buildRssNormalizedSummary("Title", "Short description.");
    expect(result).toBe("Title — Short description.");
  });

  it("truncates description to 300 chars before combining", () => {
    const longDesc = "X".repeat(400);
    const result = buildRssNormalizedSummary("Title", longDesc);
    expect(result).toContain("Title — " + "X".repeat(300));
  });

  it("caps total at 500 chars and appends ...", () => {
    const title = "T".repeat(300);
    const desc = "D".repeat(300);
    const result = buildRssNormalizedSummary(title, desc);
    expect(result.length).toBe(500);
    expect(result.endsWith("...")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mapRssItemToSignal
// ---------------------------------------------------------------------------

describe("mapRssItemToSignal", () => {
  const baseItem: RssFeedItem = {
    title: "Microsoft Patches Zero-Day CVE-2024-30080 Under Active Exploitation",
    description: "Microsoft released an emergency patch for CVE-2024-30080, a remote code execution vulnerability being actively exploited in the wild.",
    link: "https://www.bleepingcomputer.com/news/microsoft-zero-day/",
    guid: "https://www.bleepingcomputer.com/news/microsoft-zero-day/",
    pubDate: "Mon, 11 Jun 2024 12:00:00 +0000"
  };

  it("uses provided source slug", () => {
    expect(mapRssItemToSignal(baseItem, "bleepingcomputer")?.source).toBe("bleepingcomputer");
    expect(mapRssItemToSignal(baseItem, "krebsonsecurity")?.source).toBe("krebsonsecurity");
  });

  it("derives patch_advisory signal_type for patch title", () => {
    expect(mapRssItemToSignal(baseItem, "bleepingcomputer")?.signal_type).toBe("patch_advisory");
  });

  it("derives Critical severity for 'actively exploited' in title", () => {
    // Title contains "Active Exploitation" and "Zero-Day"
    const item: RssFeedItem = { ...baseItem, title: "Actively Exploited Zero-Day in Fortinet" };
    expect(mapRssItemToSignal(item, "bleepingcomputer")?.severity).toBe("Critical");
  });

  it("derives third_party_breach for breach title", () => {
    const item: RssFeedItem = { ...baseItem, title: "Snowflake Customer Data Breach Impacts Hundreds of Companies" };
    expect(mapRssItemToSignal(item, "krebsonsecurity")?.signal_type).toBe("third_party_breach");
  });

  it("derives threat_actor for ransomware title", () => {
    const item: RssFeedItem = { ...baseItem, title: "BlackCat Ransomware Group Targets US Healthcare Networks" };
    expect(mapRssItemToSignal(item, "bleepingcomputer")?.signal_type).toBe("threat_actor");
  });

  it("extracts CVE from title", () => {
    const signal = mapRssItemToSignal(baseItem, "bleepingcomputer");
    expect(signal?.affected_cve).toBe("CVE-2024-30080");
  });

  it("extracts vendor from title", () => {
    const signal = mapRssItemToSignal(baseItem, "bleepingcomputer");
    expect(signal?.affected_vendor).toBe("Microsoft");
  });

  it("includes guid in raw_payload for dedup stability", () => {
    const signal = mapRssItemToSignal(baseItem, "bleepingcomputer");
    expect(signal?.raw_payload.guid).toBe(baseItem.guid);
    expect(signal?.raw_payload.link).toBe(baseItem.link);
  });

  it("includes source in raw_payload", () => {
    const signal = mapRssItemToSignal(baseItem, "sans_isc");
    expect(signal?.raw_payload.source).toBe("sans_isc");
  });

  it("returns null for empty title", () => {
    const item: RssFeedItem = { ...baseItem, title: "" };
    expect(mapRssItemToSignal(item, "bleepingcomputer")).toBeNull();
  });

  it("sets affected_cve to null when no CVE anywhere", () => {
    const item: RssFeedItem = {
      ...baseItem,
      title: "Krebs: Inside the World of Cybercrime Forums",
      description: "No specific CVE mentioned in this article."
    };
    const signal = mapRssItemToSignal(item, "krebsonsecurity");
    expect(signal?.affected_cve).toBeNull();
  });

  it("sets affected_vendor to null when no known vendor in title", () => {
    const item: RssFeedItem = {
      ...baseItem,
      title: "Threat Actor Targets Small Businesses with Phishing Kits"
    };
    const signal = mapRssItemToSignal(item, "bleepingcomputer");
    expect(signal?.affected_vendor).toBeNull();
  });
});
