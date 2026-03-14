import Parser from "rss-parser";

const parser = new Parser();

export async function fetchSecuritySignals() {

  const feed = await parser.parseURL(
    "https://feeds.feedburner.com/TheHackersNews"
  );

  return feed.items.slice(0,5).map((item, i) => ({
    eventType: "signal.ingested",
    signalId: `SIG-SEC-${i}`,
    source: "security_news",
    title: item.title,
    timestamp: new Date().toISOString(),
    payload: item.contentSnippet || item.content || item.title
  }));

}