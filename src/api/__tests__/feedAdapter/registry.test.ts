/**
 * registry.test.ts — Registry shape + per-feed mapping equivalence.
 *
 * Verifies:
 *   - The registered adapters: 3 threat-intel + 3 regulatory (NIST, FTC, and
 *     the ONC healthcare feed).
 *   - Each adapter declares the expected id, sourceTier, signalType, and
 *     uses the correct mapper (proven by sending a hand-crafted item
 *     through toCyberSignal() and asserting the produced ingest payload).
 *   - THREAT_INTEL_FEED_IDS and REGULATORY_FEED_IDS sets match the legacy
 *     surface preserved for the /cyber-signals/fetch/* admin routes.
 */

import { describe, it, expect } from "vitest";
import {
  FEEDS,
  THREAT_INTEL_FEED_IDS,
  REGULATORY_FEED_IDS
} from "../../lib/feedAdapter/registry.js";
import type { RssFeedItem } from "../../lib/feedAdapter/threatIntelHelpers.js";
import type { RegulatoryFeedItem } from "../../lib/feedAdapter/regulatoryHelpers.js";

describe("registry shape", () => {

  it("registers the threat-intel + regulatory RSS feeds (incl. ONC healthcare)", () => {
    expect(FEEDS.map((f) => f.id).sort()).toEqual([
      "bleepingcomputer",
      "ftc_news",
      "krebsonsecurity",
      "nist_news",
      "onc_healthit",
      "sans_isc"
    ]);
  });


  it("threat-intel feeds are sourceTier 2, regulatory feeds are sourceTier 1", () => {
    const byId = Object.fromEntries(FEEDS.map((f) => [f.id, f]));
    expect(byId.bleepingcomputer.sourceTier).toBe(2);
    expect(byId.krebsonsecurity.sourceTier).toBe(2);
    expect(byId.sans_isc.sourceTier).toBe(2);
    expect(byId.nist_news.sourceTier).toBe(1);
    expect(byId.ftc_news.sourceTier).toBe(1);
    expect(byId.onc_healthit.sourceTier).toBe(1);
  });

  it("threat-intel feeds default to patch_advisory; regulatory to regulatory_change", () => {
    const byId = Object.fromEntries(FEEDS.map((f) => [f.id, f]));
    expect(byId.bleepingcomputer.signalType).toBe("patch_advisory");
    expect(byId.krebsonsecurity.signalType).toBe("patch_advisory");
    expect(byId.sans_isc.signalType).toBe("patch_advisory");
    expect(byId.nist_news.signalType).toBe("regulatory_change");
    expect(byId.ftc_news.signalType).toBe("regulatory_change");
    expect(byId.onc_healthit.signalType).toBe("regulatory_change");
  });

  it("no feed declares a defaultVendor (existing 5 derive vendor per item or leave null)", () => {
    for (const feed of FEEDS) {
      expect(feed.defaultVendor).toBeUndefined();
    }
  });

  it("THREAT_INTEL_FEED_IDS contains the three threat-intel ids", () => {
    expect([...THREAT_INTEL_FEED_IDS].sort()).toEqual([
      "bleepingcomputer",
      "krebsonsecurity",
      "sans_isc"
    ]);
  });

  it("REGULATORY_FEED_IDS contains the regulatory ids (incl. ONC healthcare)", () => {
    expect([...REGULATORY_FEED_IDS].sort()).toEqual(["ftc_news", "nist_news", "onc_healthit"]);
  });
});

describe("per-feed toCyberSignal mapping", () => {
  // Hand-crafted item routed through each threat-intel feed; the mapper
  // (mapRssItemToSignal) is identical across the three so the produced
  // signal differs only on `source` and `raw_payload.source`.
  const sampleRssItem: RssFeedItem = {
    title: "Microsoft Patches Zero-Day CVE-2024-30080 Under Active Exploitation",
    description: "Microsoft released an emergency patch for CVE-2024-30080.",
    link: "https://example.com/article",
    guid: "https://example.com/article",
    pubDate: "Mon, 11 Jun 2024 12:00:00 +0000"
  };

  it("bleepingcomputer maps via threat-intel mapper and stamps source", () => {
    const feed = FEEDS.find((f) => f.id === "bleepingcomputer")!;
    const signal = feed.toCyberSignal(sampleRssItem) as ReturnType<typeof feed.toCyberSignal>;
    expect(signal).not.toBeNull();
    expect(signal!.source).toBe("bleepingcomputer");
    expect(signal!.signal_type).toBe("patch_advisory"); // 'patches' / 'zero-day' route
    expect(signal!.severity).toBe("Critical");          // 'zero-day' wins
    expect(signal!.affected_vendor).toBe("Microsoft");
    expect(signal!.affected_cve).toBe("CVE-2024-30080");
    expect(signal!.raw_payload.source).toBe("bleepingcomputer");
  });

  it("krebsonsecurity stamps the krebsonsecurity source on identical input", () => {
    const feed = FEEDS.find((f) => f.id === "krebsonsecurity")!;
    const signal = feed.toCyberSignal(sampleRssItem)!;
    expect(signal.source).toBe("krebsonsecurity");
    expect(signal.raw_payload.source).toBe("krebsonsecurity");
  });

  it("sans_isc stamps the sans_isc source on identical input", () => {
    const feed = FEEDS.find((f) => f.id === "sans_isc")!;
    const signal = feed.toCyberSignal(sampleRssItem)!;
    expect(signal.source).toBe("sans_isc");
  });

  it("threat-intel mapper drops items without a title (returns null)", () => {
    const feed = FEEDS.find((f) => f.id === "bleepingcomputer")!;
    const noTitle = { ...sampleRssItem, title: "" };
    expect(feed.toCyberSignal(noTitle)).toBeNull();
  });

  // Regulatory mapper has additional relevance filter — cybersecurity
  // keywords required in title or description.
  const sampleRegulatoryItem: RegulatoryFeedItem = {
    title: "NIST Cybersecurity Framework 2.0 Released",
    description: "Major update to the framework.",
    link: "https://www.nist.gov/news/csf-2",
    guid: "nist-csf-2-release",
    pubDate: "Wed, 26 Feb 2024 09:00:00 +0000"
  };

  it("nist_news maps via regulatory mapper and stamps source", () => {
    const feed = FEEDS.find((f) => f.id === "nist_news")!;
    const signal = feed.toCyberSignal(sampleRegulatoryItem)!;
    expect(signal.source).toBe("nist_news");
    expect(signal.signal_type).toBe("regulatory_change");
    expect(signal.affected_vendor).toBeNull();
    expect(signal.affected_cve).toBeNull();
  });

  it("ftc_news stamps the ftc_news source on identical input", () => {
    const feed = FEEDS.find((f) => f.id === "ftc_news")!;
    const signal = feed.toCyberSignal(sampleRegulatoryItem)!;
    expect(signal.source).toBe("ftc_news");
  });

  it("onc_healthit maps healthcare-regulatory items via the regulatory mapper", () => {
    const feed = FEEDS.find((f) => f.id === "onc_healthit")!;
    const hipaaItem: RegulatoryFeedItem = {
      title: "ONC Finalizes HIPAA Security Rule Updates for Health IT",
      description: "New privacy and breach-notification expectations for certified health IT.",
      link: "https://www.healthit.gov/blog/hipaa-security-update",
      guid: "onc-hipaa-security-update",
      pubDate: "Tue, 23 Jun 2026 09:00:00 +0000"
    };
    const signal = feed.toCyberSignal(hipaaItem)!;
    expect(signal.source).toBe("onc_healthit");
    expect(signal.signal_type).toBe("regulatory_change");
    expect(signal.affected_vendor).toBeNull();
    expect(signal.affected_cve).toBeNull();
  });

  it("regulatory mapper drops items without cybersecurity-relevance keywords", () => {
    const feed = FEEDS.find((f) => f.id === "nist_news")!;
    const noisyItem: RegulatoryFeedItem = {
      title: "NIST Awards Research Grant for Quantum Computing Materials",
      description: "The award supports superconducting qubit research.",
      link: "https://www.nist.gov/news/quantum-grant",
      guid: "nist-quantum-grant",
      pubDate: null
    };
    expect(feed.toCyberSignal(noisyItem)).toBeNull();
  });
});
