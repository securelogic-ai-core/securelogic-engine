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
    url: "https://www.ftc.gov/rss/news.xml",
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
  "ftc_news"
]);
