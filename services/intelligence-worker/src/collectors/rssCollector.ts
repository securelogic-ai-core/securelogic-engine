import Parser from "rss-parser";

// Hard cap: if a feed does not respond within this window, treat as failed.
// rss-parser has no built-in timeout; we race against a rejection.
const FEED_TIMEOUT_MS = 15_000;

const parser = new Parser();

export type CollectedSignal = {
  title: string
  source: string
  sourceUrl: string
  summary?: string
  publishedAt?: string
}

function parseWithTimeout(url: string): Promise<Parser.Output<Record<string, unknown>>> {
  return Promise.race([
    parser.parseURL(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`feed_timeout: ${url}`)), FEED_TIMEOUT_MS).unref()
    )
  ]);
}

export async function collectRssSignals(): Promise<CollectedSignal[]> {

  const feedUrl = "https://www.cisa.gov/news.xml"

  const feed = await parseWithTimeout(feedUrl)

  const signals: CollectedSignal[] = []

  for (const item of feed.items) {

    if (!item.link || !item.title) continue

    signals.push({
      title: item.title,
      source: "CISA",
      sourceUrl: item.link,
      summary: item.contentSnippet ?? "",
      publishedAt: item.pubDate ?? undefined
    })

  }

  return signals
}
