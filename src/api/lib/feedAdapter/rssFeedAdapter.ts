/**
 * rssFeedAdapter.ts — RSS/Atom implementation of FeedAdapter.
 *
 * Wraps an HTTP GET + XML parse around a per-feed mapper. The factory
 * `makeRssFeed()` is the canonical way to register an RSS source in
 * `registry.ts` — the existing five feeds (BleepingComputer, Krebs,
 * SANS ISC, NIST news, FTC news) are all instances of this factory.
 *
 * XML parsing is delegated to the helpers exported by cisaAlertsAdapter
 * (`extractRssItems`, `extractXmlField`) — same parser used by the
 * pre-refactor adapters, so item-list extraction is byte-identical.
 *
 * Error semantics: `fetch()` throws on non-2xx HTTP status. The aggregator
 * (`fetchAllFeeds()` in index.ts) is responsible for per-adapter try/catch
 * so one feed failing does not block the others.
 */

import { extractRssItems, extractXmlField } from "../cisaAlertsAdapter.js";
import type {
  CyberSignalIngestInput,
  FeedAdapter,
  SignalType,
  SourceTier
} from "./types.js";
import type { RssFeedItem } from "./threatIntelHelpers.js";

export type { RssFeedItem };

/**
 * Mapper closure: pure conversion from a parsed RSS item to an ingest
 * payload. Per-feed concerns (relevance filtering, signal_type derivation
 * from title keywords, vendor matching) live inside the closure rather
 * than as separate config fields — the closure keeps the behavior fully
 * encapsulated and lets each feed evolve its own mapping rules.
 */
export type RssItemMapper = (
  item: RssFeedItem,
  source: string
) => CyberSignalIngestInput | null;

export type RssFeedConfig = {
  id: string;
  url: string;
  sourceTier: SourceTier;
  signalType: SignalType;
  defaultVendor?: string;
  mapper: RssItemMapper;
  /**
   * User-Agent string for the outbound HTTP request. Defaults to
   * "SecureLogic-AI/1.0 (Feed Adapter)" when unset.
   */
  userAgent?: string;
};

const DEFAULT_USER_AGENT = "SecureLogic-AI/1.0 (Feed Adapter)";

/**
 * Pull and parse one RSS/Atom feed. Returns the per-item shape used by
 * mappers. Throws on HTTP failure; caller wraps in try/catch.
 *
 * Items lacking a title are silently dropped at the parse stage — the
 * legacy adapters did the same (a title-less item has nothing to derive
 * signal_type / severity / dedup key from).
 */
async function fetchRssItems(url: string, userAgent: string): Promise<RssFeedItem[]> {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/rss+xml, application/xml, text/xml",
      "User-Agent": userAgent
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const itemXmls = extractRssItems(xml);

  const items: RssFeedItem[] = [];

  for (const itemXml of itemXmls) {
    const title = extractXmlField(itemXml, "title");
    if (!title) continue;

    const description = extractXmlField(itemXml, "description");
    const link = extractXmlField(itemXml, "link");
    const guid = extractXmlField(itemXml, "guid");
    const pubDate = extractXmlField(itemXml, "pubDate");

    items.push({ title, description, link, guid, pubDate });
  }

  return items;
}

/**
 * Build a `FeedAdapter<RssFeedItem>` for a single RSS source. The returned
 * object carries metadata (id, sourceTier, signalType, defaultVendor) plus
 * `fetch()` / `toCyberSignal()` closures bound to the supplied URL and
 * mapper.
 */
export function makeRssFeed(config: RssFeedConfig): FeedAdapter<RssFeedItem> {
  const userAgent = config.userAgent ?? DEFAULT_USER_AGENT;

  const adapter: FeedAdapter<RssFeedItem> = {
    kind: "rss",
    id: config.id,
    sourceTier: config.sourceTier,
    signalType: config.signalType,
    fetch: () => fetchRssItems(config.url, userAgent),
    toCyberSignal: (item) => config.mapper(item, config.id)
  };

  if (config.defaultVendor !== undefined) {
    adapter.defaultVendor = config.defaultVendor;
  }

  return adapter;
}
