/**
 * registry.ts — Registered FeedAdapter instances.
 *
 * One entry per upstream source. The five existing RSS feeds are ported
 * verbatim from the legacy threatIntelRssAdapter.ts and regulatoryFeedAdapter.ts.
 * Per-feed mapping is delegated to the pure helpers in threatIntelHelpers.ts
 * and regulatoryHelpers.ts so behavior is byte-identical to the pre-refactor
 * pipeline.
 *
 * To add a new feed in the next PR: append a `makeRssFeed(...)`,
 * `makeJsonFeed(...)`, or `makeHtmlScrapedFeed(...)` entry below. No other
 * file needs to change — `fetchAllFeeds()` (index.ts) iterates this array.
 */

import { makeRssFeed } from "./rssFeedAdapter.js";
import { mapRssItemToSignal } from "./threatIntelHelpers.js";
import { mapRegulatoryItemToSignal } from "./regulatoryHelpers.js";
import type { FeedAdapter } from "./types.js";

/**
 * All registered feed adapters. Order is registration order; `fetchAllFeeds()`
 * polls them sequentially (RSS feeds are small and rate-limit themselves on
 * the upstream side; parallel fetches are unnecessary).
 */
export const FEEDS: FeedAdapter[] = [
  // ── Threat-intel RSS (Tier 2 — curated security press) ────────────────
  makeRssFeed({
    id: "bleepingcomputer",
    url: "https://www.bleepingcomputer.com/feed/",
    sourceTier: 2,
    signalType: "patch_advisory",
    mapper: mapRssItemToSignal
  }),
  makeRssFeed({
    id: "krebsonsecurity",
    url: "https://krebsonsecurity.com/feed/",
    sourceTier: 2,
    signalType: "patch_advisory",
    mapper: mapRssItemToSignal
  }),
  makeRssFeed({
    id: "sans_isc",
    url: "https://isc.sans.edu/rssfeed_full.xml",
    sourceTier: 2,
    signalType: "patch_advisory",
    mapper: mapRssItemToSignal
  }),

  // ── Regulatory RSS (Tier 1 — US-gov authoritative) ────────────────────
  makeRssFeed({
    id: "nist_news",
    url: "https://www.nist.gov/news-events/news/rss.xml",
    sourceTier: 1,
    signalType: "regulatory_change",
    mapper: mapRegulatoryItemToSignal
  }),
  makeRssFeed({
    id: "ftc_news",
    // The legacy https://www.ftc.gov/rss/news.xml now 404s — FTC moved its feed
    // to /feeds/press-release.xml (verified 2026-06-24). The old URL was a dead
    // feed silently producing zero items; feed-health would flag it as failing.
    url: "https://www.ftc.gov/feeds/press-release.xml",
    sourceTier: 1,
    signalType: "regulatory_change",
    mapper: mapRegulatoryItemToSignal
  }),

  // ── Healthcare regulatory RSS (Tier 1 — US-gov authoritative) ─────────
  // ONC / ASTP (Office of the National Coordinator for Health IT). The
  // regulatory mapper's relevance filter keeps only cyber/privacy-relevant
  // posts (HIPAA, breach, security, privacy …); the rest are dropped, so this
  // adds healthcare-regulatory coverage without noise. Flows through the
  // obligation branch like the other regulatory feeds.
  //
  // NOTE: CMS was evaluated alongside ONC but exposes no discoverable RSS feed
  // (its newsroom is a JS-rendered SPA; every documented feed path 404s as of
  // 2026-06-24). It is intentionally NOT registered — a 404 feed would only
  // generate perpetual feed-health failures. CMS needs a different integration
  // (GovDelivery email or HTML scrape), tracked separately.
  makeRssFeed({
    id: "onc_healthit",
    url: "https://healthit.gov/blog/feed/",
    sourceTier: 1,
    signalType: "regulatory_change",
    mapper: mapRegulatoryItemToSignal
  })
];

/**
 * Stable id-set for the threat-intel feeds. Preserved as a discrete export
 * so `POST /api/cyber-signals/fetch/threat-intel-rss` can validate caller-
 * supplied source filters against the same set the legacy adapter exposed.
 */
export const THREAT_INTEL_FEED_IDS: ReadonlySet<string> = new Set([
  "bleepingcomputer",
  "krebsonsecurity",
  "sans_isc"
]);

/** Stable id-set for the regulatory feeds. */
export const REGULATORY_FEED_IDS: ReadonlySet<string> = new Set([
  "nist_news",
  "ftc_news",
  "onc_healthit"
]);
