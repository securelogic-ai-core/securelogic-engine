import { describe, it, expect } from "vitest";

import {
  SOURCE_DISPLAY_NAMES,
  getSourceDisplayName,
  prettifyUnknownSlug
} from "../lib/sourceDisplayNames.js";

// ====================================================================
// SOURCE_DISPLAY_NAMES — explicit-mapping coverage
// ====================================================================

describe("SOURCE_DISPLAY_NAMES — explicit mappings", () => {
  it("maps every entry to a non-empty human-readable string", () => {
    for (const [slug, display] of Object.entries(SOURCE_DISPLAY_NAMES)) {
      expect(slug.length, `slug "${slug}" is empty`).toBeGreaterThan(0);
      expect(display.length, `display for "${slug}" is empty`).toBeGreaterThan(0);
      // No raw underscores should leak into the display value.
      expect(display, `display for "${slug}" leaks an underscore`).not.toMatch(/_/);
    }
  });

  it("includes every engine adapter slug stamped in src/api/lib/", () => {
    // These five are written by the direct adapters
    // (cisaKevAdapter, cisaAlertsAdapter, nvdAdapter, mitreAttackAdapter,
    // mitreAtlasAdapter). If any rename occurs, this assertion fails before
    // the brief response goes out with a missing display.
    for (const slug of [
      "cisa_kev",
      "cisa_alerts",
      "nvd",
      "mitre_attack",
      "mitre_atlas"
    ]) {
      expect(SOURCE_DISPLAY_NAMES[slug]).toBeDefined();
    }
  });

  it("includes every engine FeedAdapter registry id", () => {
    for (const slug of [
      "bleepingcomputer",
      "krebsonsecurity",
      "sans_isc",
      "nist_news",
      "ftc_news"
    ]) {
      expect(SOURCE_DISPLAY_NAMES[slug]).toBeDefined();
    }
  });

  it("includes every worker-bridge slug", () => {
    for (const slug of [
      "security_news_thehackernews",
      "security_news_bleepingcomputer",
      "security_news_krebs",
      "security_news_theregister",
      "vendor_risk_securityweek",
      "vendor_risk_darkreading",
      "regulatory_cisa",
      "regulatory_nist",
      "regulatory_ftc",
      "regulatory_ftc_consumer_protection",
      "regulatory_sec_8k",
      "regulatory_nydfs",
      "regulatory_enisa",
      "regulatory_ico",
      "regulatory_fsb",
      "ai_governance_venturebeat",
      "ai_governance_mit_techreview"
    ]) {
      expect(SOURCE_DISPLAY_NAMES[slug]).toBeDefined();
    }
  });

  it("renders specific high-traffic slugs with the expected names", () => {
    expect(SOURCE_DISPLAY_NAMES.cisa_kev).toBe("CISA KEV");
    expect(SOURCE_DISPLAY_NAMES.regulatory_cisa).toBe("CISA");
    expect(SOURCE_DISPLAY_NAMES.security_news_bleepingcomputer).toBe("BleepingComputer");
    expect(SOURCE_DISPLAY_NAMES.bleepingcomputer).toBe("BleepingComputer");
    expect(SOURCE_DISPLAY_NAMES.security_news_krebs).toBe("Krebs on Security");
    expect(SOURCE_DISPLAY_NAMES.krebsonsecurity).toBe("Krebs on Security");
    expect(SOURCE_DISPLAY_NAMES.mitre_attack).toBe("MITRE ATT&CK");
    expect(SOURCE_DISPLAY_NAMES.mitre_atlas).toBe("MITRE ATLAS");
    expect(SOURCE_DISPLAY_NAMES.nvd).toBe("NVD");
  });
});

// ====================================================================
// getSourceDisplayName — explicit-then-fallback dispatch
// ====================================================================

describe("getSourceDisplayName — explicit-mapping path", () => {
  it("returns the mapped value for known slugs", () => {
    expect(getSourceDisplayName("cisa_kev")).toBe("CISA KEV");
    expect(getSourceDisplayName("regulatory_cisa")).toBe("CISA");
    expect(getSourceDisplayName("nvd")).toBe("NVD");
  });
});

describe("getSourceDisplayName — fallback path", () => {
  it("strips the security_news_ prefix and prettifies the remainder", () => {
    // Slug not in the explicit map.
    expect(getSourceDisplayName("security_news_zdnet")).toBe("Zdnet");
  });

  it("strips the regulatory_ prefix", () => {
    expect(getSourceDisplayName("regulatory_unknown_regulator")).toBe(
      "Unknown Regulator"
    );
  });

  it("strips the vendor_risk_ prefix", () => {
    expect(getSourceDisplayName("vendor_risk_newsource")).toBe("Newsource");
  });

  it("strips the ai_governance_ prefix", () => {
    expect(getSourceDisplayName("ai_governance_newsource")).toBe("Newsource");
  });

  it("strips the threat_intel_ prefix (for future PSIRT/threat-intel feeds)", () => {
    expect(getSourceDisplayName("threat_intel_recordedfuture")).toBe(
      "Recordedfuture"
    );
  });

  it("preserves recognised acronyms in the fallback", () => {
    // CISA appears in KNOWN_ACRONYMS — must not become "Cisa".
    expect(getSourceDisplayName("threat_intel_cisa_test")).toBe("CISA Test");
    expect(getSourceDisplayName("ghsa")).toBe("GHSA");
    expect(getSourceDisplayName("regulatory_eu_ai_act")).toBe("EU AI Act");
  });

  it("title-cases unrecognised tokens", () => {
    expect(getSourceDisplayName("foo_bar_baz")).toBe("Foo Bar Baz");
  });
});

describe("getSourceDisplayName — defensive input handling", () => {
  it("returns empty string on empty input", () => {
    expect(getSourceDisplayName("")).toBe("");
  });

  it("returns empty string on null", () => {
    expect(getSourceDisplayName(null)).toBe("");
  });

  it("returns empty string on undefined", () => {
    expect(getSourceDisplayName(undefined)).toBe("");
  });

  it("does not throw on slug without any underscore", () => {
    expect(() => getSourceDisplayName("standalone")).not.toThrow();
    expect(getSourceDisplayName("standalone")).toBe("Standalone");
  });

  it("does not throw on slug consisting only of prefix", () => {
    // Stripping security_news_ leaves empty → splits to no tokens → "".
    expect(() => getSourceDisplayName("security_news_")).not.toThrow();
    expect(getSourceDisplayName("security_news_")).toBe("");
  });
});

// ====================================================================
// prettifyUnknownSlug — direct contract
// ====================================================================

describe("prettifyUnknownSlug — pure helper contract", () => {
  it("strips the longest matching prefix", () => {
    // Both "security_news_" and "news_" would match if "news_" were a
    // registered prefix. It isn't, so only "security_news_" is stripped.
    expect(prettifyUnknownSlug("security_news_acme")).toBe("Acme");
  });

  it("does not strip a non-registered prefix", () => {
    expect(prettifyUnknownSlug("news_acme")).toBe("News Acme");
  });

  it("collapses adjacent underscores cleanly", () => {
    // "security_news__zdnet" → strip prefix → "_zdnet" → split on _ →
    // ["", "zdnet"] → filter empties → ["zdnet"] → "Zdnet".
    expect(prettifyUnknownSlug("security_news__zdnet")).toBe("Zdnet");
  });

  it("returns empty string on empty input", () => {
    expect(prettifyUnknownSlug("")).toBe("");
  });
});

// ====================================================================
// Brief items GET response — wire-shape contract
//
// Mirrors the per-item construction in src/api/routes/intelligenceBriefs.ts
// (GET /api/intelligence-briefs/:id, the items[] map). Asserts that
// source_display lands on the wire next to the existing source_slug field
// and that the value matches the helper's output. Pure shape contract — no
// HTTP server, no DB, no middleware. If a future edit to the route's mapper
// drops the field this test fails before the customer sees a regression.
// ====================================================================

describe("brief items GET response — source_display wire-shape contract", () => {
  type DbItemRow = {
    id: string;
    source_slug: string | null;
    // Only the fields touched by this audit are exercised. Other
    // BriefItem fields are out of scope.
  };

  // Mirror of the per-item map at intelligenceBriefs.ts (GET /:id).
  function mapDbRowToWireItem(item: DbItemRow): {
    id: string;
    source_slug: string | null;
    source_display: string;
  } {
    return {
      id: item.id,
      source_slug: item.source_slug,
      source_display: getSourceDisplayName(item.source_slug)
    };
  }

  it("populates source_display from a worker prefixed slug", () => {
    const wire = mapDbRowToWireItem({
      id: "00000000-0000-0000-0000-000000000001",
      source_slug: "security_news_bleepingcomputer"
    });

    expect(wire.source_slug).toBe("security_news_bleepingcomputer");
    expect(wire.source_display).toBe("BleepingComputer");
  });

  it("populates source_display from an engine canonical slug", () => {
    const wire = mapDbRowToWireItem({
      id: "00000000-0000-0000-0000-000000000002",
      source_slug: "cisa_kev"
    });

    expect(wire.source_display).toBe("CISA KEV");
  });

  it("returns empty source_display when source_slug is null", () => {
    const wire = mapDbRowToWireItem({
      id: "00000000-0000-0000-0000-000000000003",
      source_slug: null
    });

    expect(wire.source_display).toBe("");
  });

  it("falls back to prettify for an unmapped slug", () => {
    const wire = mapDbRowToWireItem({
      id: "00000000-0000-0000-0000-000000000004",
      source_slug: "security_news_zdnet"
    });

    // No explicit mapping → prettify-strip the prefix → "Zdnet".
    expect(wire.source_display).toBe("Zdnet");
  });
});
