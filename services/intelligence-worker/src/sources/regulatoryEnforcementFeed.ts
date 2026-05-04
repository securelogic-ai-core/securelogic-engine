/**
 * regulatoryEnforcementFeed.ts
 *
 * Collects regulatory enforcement, guidance, and disclosure signals from
 * US federal agencies, EU regulators, and financial sector bodies.
 *
 * Active sources:
 *   - FTC         — press releases covering enforcement actions and privacy guidance
 *   - SEC (8-K)   — EDGAR current report feed; covers material cybersecurity disclosures
 *                   required under SEC cyber disclosure rules (Item 1.05)
 *   - NYDFS       — circular letters and industry guidance from NY Dept of Financial Services
 *   - ENISA       — European Union Agency for Cybersecurity publications
 *   - ICO         — UK Information Commissioner's Office (GDPR enforcement)
 *   - FSB         — Financial Stability Board; global financial sector cyber risk
 *
 * Skipped sources (non-RSS — require HTML scraping):
 *   TODO: HHS OCR breach settlements — https://www.hhs.gov/hipaa/for-professionals/compliance-enforcement/agreements/index.html
 *   TODO: SEC EFTS cyber-keyword search — https://efts.sec.gov/LATEST/search-index (JSON, not RSS)
 */

import Parser from "rss-parser";
import crypto from "crypto";
import { logger } from "../../../../src/api/infra/logger.js";

const FEED_TIMEOUT_MS = 15_000;
const MAX_ITEMS_PER_FEED = 10;

const parser = new Parser({
  headers: { "User-Agent": "SecureLogic AI info@securelogicai.com" }
});

function parseWithTimeout(url: string): Promise<Parser.Output<Record<string, unknown>>> {
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
    url: "https://www.ftc.gov/feeds/press-release.xml",
    source: "regulatory_ftc"
  },
  {
    url: "https://www.ftc.gov/feeds/press-release-consumer-protection.xml",
    source: "regulatory_ftc_consumer_protection"
  },
  {
    // SEC EDGAR current 8-K Atom feed — covers material cybersecurity event disclosures
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=10&search_text=&output=atom",
    source: "regulatory_sec_8k"
  },
  {
    url: "https://www.dfs.ny.gov/industry_guidance/circular_letters/rss.xml",
    source: "regulatory_nydfs"
  },
  {
    url: "https://www.enisa.europa.eu/publications/rss",
    source: "regulatory_enisa"
  },
  {
    url: "https://ico.org.uk/about-the-ico/media-centre/rss/",
    source: "regulatory_ico"
  },
  {
    url: "https://www.fsb.org/feed/",
    source: "regulatory_fsb"
  }
];

function buildSignalId(source: string, dedupeKey: string): string {
  return `SIG-ENF-${crypto
    .createHash("sha256")
    .update(`${source}:${dedupeKey}`)
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
    category: "REGULATION",
    title,
    timestamp,
    payload,
    url
  };
}

export async function fetchRegulatoryEnforcementSignals() {
  const results: ReturnType<typeof buildEvent>[] = [];

  for (const feed of FEEDS) {
    try {
      const parsed = await parseWithTimeout(feed.url);
      const items = parsed.items.slice(0, MAX_ITEMS_PER_FEED);

      for (const item of items) {
        const title = item.title?.trim();
        if (!title) continue;

        const url = item.link?.trim() ?? undefined;
        const content =
          item.contentSnippet ?? item.content ?? item.summary ?? title;
        const publishedAt =
          item.isoDate ?? item.pubDate ?? new Date().toISOString();

        const signalId = buildSignalId(feed.source, url ?? title);
        results.push(
          buildEvent(signalId, feed.source, title, content, publishedAt, url)
        );
      }
    } catch (err) {
      // Fail-open: one unavailable feed must not block the pipeline.
      logger.warn(
        {
          event: "feed_fetch_failed",
          feed: feed.source,
          url: feed.url,
          err
        },
        "Regulatory enforcement feed fetch failed — skipping"
      );
    }
  }

  return results;
}
