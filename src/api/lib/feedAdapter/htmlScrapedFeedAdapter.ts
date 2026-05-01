/**
 * htmlScrapedFeedAdapter.ts — HTML-scraped implementation of FeedAdapter (stub).
 *
 * Vendor PSIRTs that publish security advisories as plain HTML pages
 * (no RSS, no JSON API) will register through this factory once the
 * concrete fetch + parse logic is implemented in a follow-up PR.
 *
 * Targets for the next PR:
 *   - Apple Security        → support.apple.com/en-us/HT201222
 *   - Adobe PSIRT           → helpx.adobe.com/security.html
 *   - Schneider Electric    → se.com/.../cybersecurity-and-data-privacy/...
 *   - Siemens ProductCERT   → cert-portal.siemens.com (HTML index)
 *   - ABB Cyber Security    → search.abb.com/library/...
 *
 * The factory signature is fixed now so the registry shape does not change
 * when implementations land — registry.ts will simply add new entries.
 */

import type { FeedAdapter, SignalType, SourceTier, CyberSignalIngestInput } from "./types.js";

export type HtmlItemMapper<TItem> = (
  item: TItem,
  source: string
) => CyberSignalIngestInput | null;

export type HtmlScrapedFeedConfig<TItem> = {
  id: string;
  url: string;
  sourceTier: SourceTier;
  signalType: SignalType;
  defaultVendor?: string;
  /** Pull HTML, parse, return the per-item array used by `mapper`. */
  parser: (html: string) => TItem[];
  mapper: HtmlItemMapper<TItem>;
};

/**
 * Stub factory. Returns a FeedAdapter whose `fetch()` throws — concrete
 * implementation lands in the follow-up PR. Callers should not register
 * an HTML-scraped feed yet; the type is exported so registry.ts compiles
 * when the first HTML adapter does land.
 */
export function makeHtmlScrapedFeed<TItem>(
  config: HtmlScrapedFeedConfig<TItem>
): FeedAdapter<TItem> {
  const adapter: FeedAdapter<TItem> = {
    id: config.id,
    sourceTier: config.sourceTier,
    signalType: config.signalType,
    fetch: () => {
      throw new Error(
        `htmlScrapedFeedAdapter not yet implemented (feed: ${config.id}). ` +
          "Concrete implementation lands in the PSIRT-feed follow-up PR."
      );
    },
    toCyberSignal: (item) => config.mapper(item, config.id)
  };

  if (config.defaultVendor !== undefined) {
    adapter.defaultVendor = config.defaultVendor;
  }

  return adapter;
}
