import Parser from "rss-parser";

const parser = new Parser();

export type CollectedSignal = {
  title: string
  source: string
  sourceUrl: string
  summary?: string
  publishedAt?: string
}

export async function collectRssSignals(): Promise<CollectedSignal[]> {

  const feedUrl = "https://www.cisa.gov/news.xml"

  const feed = await parser.parseURL(feedUrl)

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
