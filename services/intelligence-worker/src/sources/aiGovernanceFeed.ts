import Parser from "rss-parser";
import crypto from "crypto";

const parser = new Parser();

const FEEDS = [
  {
    url: "https://venturebeat.com/category/ai/feed/",
    source: "ai_governance_venturebeat"
  },
  {
    url: "https://www.technologyreview.com/feed/",
    source: "ai_governance_mit_techreview"
  }
];

const MAX_ITEMS_PER_FEED = 5;

export async function fetchAIGovernanceSignals() {
  const results: ReturnType<typeof buildEvent>[] = [];

  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);

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
    } catch {
      // Fail-open: one unavailable feed must not block the worker cycle
      console.warn(`[aiGovernanceFeed] failed to fetch ${feed.url} — skipping`);
    }
  }

  return results;
}

function buildSignalId(source: string, dedupeKey: string): string {
  return `SIG-AI-${crypto.createHash("sha256").update(`${source}:${dedupeKey}`).digest("hex").slice(0, 12)}`;
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
