import Parser from "rss-parser";
import crypto from "crypto";
import { logger } from "../../../../src/api/infra/logger.js";

// Hard cap per feed fetch — prevents a slow host from blocking the pipeline.
const FEED_TIMEOUT_MS = 15_000;

const parser = new Parser();

function parseWithTimeout(url: string): Promise<Parser.Output<Record<string, unknown>>> {
  return Promise.race([
    parser.parseURL(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`feed_timeout: ${url}`)), FEED_TIMEOUT_MS).unref()
    )
  ]);
}

const FEEDS = [
  {
    url: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    source: "regulatory_cisa"
  },
  {
    url: "https://csrc.nist.gov/news.rss",
    source: "regulatory_nist"
  }
];

const MAX_ITEMS_PER_FEED = 10;

export async function fetchRegulatorySignals() {
  const results: ReturnType<typeof buildEvent>[] = [];

  for (const feed of FEEDS) {
    try {
      const parsed = await parseWithTimeout(feed.url);

      const items = parsed.items.slice(0, MAX_ITEMS_PER_FEED);

      for (const item of items) {
        const title = item.title?.trim();
        if (!title) continue;

        const url = item.link?.trim() ?? undefined;
        const content = item.contentSnippet ?? item.content ?? item.summary ?? title;
        const publishedAt = item.isoDate ?? item.pubDate ?? new Date().toISOString();
        const signalId = buildSignalId(feed.source, url ?? title);

        results.push(buildEvent(signalId, feed.source, title, content, publishedAt, url));
      }
    } catch (err) {
      // Fail-open: one unavailable or timed-out feed must not block the pipeline.
      logger.warn({ event: "feed_fetch_failed", feed: feed.source, url: feed.url, err }, "Regulatory feed fetch failed — skipping");
    }
  }

  return results;
}

function buildSignalId(source: string, dedupeKey: string): string {
  return `SIG-REG-${crypto.createHash("sha256").update(`${source}:${dedupeKey}`).digest("hex").slice(0, 12)}`;
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
    title,
    timestamp,
    payload,
    url
  };
}
