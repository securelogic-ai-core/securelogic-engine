/**
 * jsonFeedAdapter.ts — JSON-API implementation of FeedAdapter (stub).
 *
 * Vendor PSIRTs that publish CVRF (Common Vulnerability Reporting Format)
 * or other JSON shapes will register through this factory once the
 * concrete fetch + parse logic is implemented in a follow-up PR.
 *
 * Targets for the next PR:
 *   - Microsoft MSRC      → api.msrc.microsoft.com/cvrf/v3.0/...
 *   - Cisco PSIRT         → api.cisco.com/security/advisories/openvulnapi
 *   - GitHub GHSA         → api.github.com/graphql (security advisories)
 *
 * The factory signature is fixed now so the registry shape does not change
 * when implementations land — registry.ts will simply add new entries.
 */

import type { FeedAdapter, SignalType, SourceTier, CyberSignalIngestInput } from "./types.js";

export type JsonItemMapper<TItem> = (
  item: TItem,
  source: string
) => CyberSignalIngestInput | null;

export type JsonFeedConfig<TItem> = {
  id: string;
  url: string;
  sourceTier: SourceTier;
  signalType: SignalType;
  defaultVendor?: string;
  /** Pull JSON, parse, return the per-item array used by `mapper`. */
  parser: (rawJson: unknown) => TItem[];
  mapper: JsonItemMapper<TItem>;
};

/**
 * Stub factory. Returns a FeedAdapter whose `fetch()` throws — concrete
 * implementation lands in the follow-up PR. Callers should not register
 * a JSON feed yet; the type is exported so registry.ts compiles when
 * the first JSON adapter does land.
 */
export function makeJsonFeed<TItem>(
  config: JsonFeedConfig<TItem>
): FeedAdapter<TItem> {
  const adapter: FeedAdapter<TItem> = {
    id: config.id,
    sourceTier: config.sourceTier,
    signalType: config.signalType,
    fetch: () => {
      throw new Error(
        `jsonFeedAdapter not yet implemented (feed: ${config.id}). ` +
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
