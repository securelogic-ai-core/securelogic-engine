/**
 * vendorRiskFeed.ts
 *
 * Collects vendor risk, supply chain, and third-party breach signals from
 * security news sources. Items are filtered to those with vendor, supply
 * chain, or third-party relevance before being returned to the pipeline.
 *
 * Sources:
 *   - SecurityWeek (covers vendor and supply chain incidents)
 *   - Dark Reading (covers third-party and vendor breach coverage)
 */

import Parser from "rss-parser";
import crypto from "crypto";
import { logger } from "../../../../src/api/infra/logger.js";

const FEED_TIMEOUT_MS = 15_000;
const MAX_ITEMS_PER_FEED = 8;

const parser = new Parser();

function parseWithTimeout(
  url: string
): Promise<Parser.Output<Record<string, unknown>>> {
  return Promise.race([
    parser.parseURL(url),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`feed_timeout: ${url}`)),
        FEED_TIMEOUT_MS
      ).unref()
    )
  ]);
}

const FEEDS = [
  {
    url: "https://feeds.feedburner.com/securityweek",
    source: "vendor_risk_securityweek"
  },
  {
    url: "https://www.darkreading.com/rss/all.xml",
    source: "vendor_risk_darkreading"
  }
];

/**
 * Keywords that indicate vendor, supply chain, or third-party risk.
 * Items not matching are dropped — keeps the section signal-dense.
 */
const VENDOR_RISK_KEYWORDS = [
  "vendor",
  "third-party",
  "third party",
  "supply chain",
  "supplier",
  "saas",
  "cloud provider",
  "service provider",
  "partner",
  "contractor",
  "outsourc",
  "managed service",
  "mssp",
  "software dependency",
  "open source",
  "npm",
  "pypi",
  "maven",
  "dependency",
  "data breach",
  "exposed customer",
  "leaked",
  "compromised",
  "backdoor",
  "malicious package",
  "typosquat"
];

function isVendorRiskRelevant(title: string, content: string): boolean {
  const text = `${title} ${content}`.toLowerCase();
  return VENDOR_RISK_KEYWORDS.some((kw) => text.includes(kw));
}

function buildSignalId(source: string, key: string): string {
  return `SIG-VND-${crypto
    .createHash("sha256")
    .update(`${source}:${key}`)
    .digest("hex")
    .slice(0, 12)}`;
}

function buildEvent(
  signalId: string,
  source: string,
  title: string,
  payload: string,
  timestamp: string,
  url?: string
) {
  return {
    eventType: "signal.ingested" as const,
    signalId,
    source,
    category: "VENDOR_RISK",
    title,
    timestamp,
    payload,
    url
  };
}

export async function fetchVendorRiskSignals() {
  const results: ReturnType<typeof buildEvent>[] = [];

  for (const feed of FEEDS) {
    try {
      const parsed = await parseWithTimeout(feed.url);
      const items = parsed.items.slice(0, MAX_ITEMS_PER_FEED);

      for (const item of items) {
        const title = item.title?.trim();
        if (!title) continue;

        const content =
          item.contentSnippet ?? item.content ?? item.summary ?? title;
        const url = item.link?.trim() ?? undefined;
        const publishedAt =
          item.isoDate ?? item.pubDate ?? new Date().toISOString();

        if (!isVendorRiskRelevant(title, content)) continue;

        const signalId = buildSignalId(feed.source, url ?? title);
        results.push(
          buildEvent(signalId, feed.source, title, content, publishedAt, url)
        );
      }
    } catch (err) {
      logger.warn(
        {
          event: "feed_fetch_failed",
          feed: feed.source,
          url: feed.url,
          err
        },
        "Vendor risk feed fetch failed — skipping"
      );
    }
  }

  return results;
}
