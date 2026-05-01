/**
 * feedAdapter/index.ts — Public surface for the feed-adapter subsystem.
 *
 * Callers (briefScheduler, /cyber-signals/fetch/* admin routes) should
 * import `fetchAllFeeds` from here and pass an optional `{ ids }` filter
 * to scope the run. The aggregator handles per-adapter try/catch so a
 * single feed failing does not abort the others — failures are surfaced
 * in the `results` map under the corresponding feed id.
 */

import { logger } from "../../infra/logger.js";
import { FEEDS } from "./registry.js";
import type {
  CyberSignalIngestInput,
  FeedAdapter,
  FetchAllFeedsFilter,
  FetchAllFeedsResult,
  FeedResult
} from "./types.js";

export type {
  CyberSignalIngestInput,
  FeedAdapter,
  FetchAllFeedsFilter,
  FetchAllFeedsResult,
  FeedResult,
  SignalType,
  SourceTier
} from "./types.js";
export { makeRssFeed } from "./rssFeedAdapter.js";
export type { RssFeedItem, RssFeedConfig, RssItemMapper } from "./rssFeedAdapter.js";
export { makeJsonFeed } from "./jsonFeedAdapter.js";
export type { JsonFeedConfig, JsonItemMapper } from "./jsonFeedAdapter.js";
export { makeHtmlScrapedFeed } from "./htmlScrapedFeedAdapter.js";
export type {
  HtmlScrapedFeedConfig,
  HtmlItemMapper
} from "./htmlScrapedFeedAdapter.js";
export {
  FEEDS,
  THREAT_INTEL_FEED_IDS,
  REGULATORY_FEED_IDS
} from "./registry.js";

/**
 * Run every (or filtered) registered FeedAdapter. Returns the flat list
 * of mapped CyberSignalIngestInput rows plus a per-feed results envelope
 * (`total`, `mapped`, `skipped`, optional `error`) keyed by feed id.
 *
 * Per-adapter failures are isolated — one feed throwing does not block
 * the others. Each error is logged at warn level with the feed id.
 *
 * @param filter Optional `{ ids: string[] }` to scope the run to a subset
 *               of registered feeds. Unknown ids are silently ignored.
 */
export async function fetchAllFeeds(
  filter?: FetchAllFeedsFilter
): Promise<FetchAllFeedsResult> {
  const targets = filterAdapters(FEEDS, filter);

  const allSignals: CyberSignalIngestInput[] = [];
  const results: Record<string, FeedResult> = {};

  for (const adapter of targets) {
    try {
      const items = await adapter.fetch();
      const mapped: CyberSignalIngestInput[] = [];
      let skipped = 0;

      for (const item of items) {
        const signal = adapter.toCyberSignal(item);
        if (signal === null) {
          skipped++;
          continue;
        }
        mapped.push(signal);
      }

      allSignals.push(...mapped);
      results[adapter.id] = {
        total: items.length,
        mapped: mapped.length,
        skipped
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results[adapter.id] = {
        total: 0,
        mapped: 0,
        skipped: 0,
        error: errorMsg
      };
      logger.warn(
        { event: "feed_adapter_failed", feedId: adapter.id, err },
        `Feed adapter ${adapter.id} failed — continuing with other feeds`
      );
    }
  }

  return { signals: allSignals, results };
}

function filterAdapters(
  adapters: FeedAdapter[],
  filter?: FetchAllFeedsFilter
): FeedAdapter[] {
  if (!filter || !filter.ids || filter.ids.length === 0) return adapters;
  const allowed = new Set(filter.ids);
  return adapters.filter((a) => allowed.has(a.id));
}
