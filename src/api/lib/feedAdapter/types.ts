/**
 * feedAdapter/types.ts — Generic FeedAdapter abstraction.
 *
 * A FeedAdapter is anything that can be polled to produce a list of items
 * and map each item into a CyberSignalIngestInput. Concrete implementations
 * exist for RSS/Atom (rssFeedAdapter), JSON APIs (jsonFeedAdapter), and
 * HTML-scraped sources (htmlScrapedFeedAdapter).
 *
 * The shape is deliberately format-agnostic so that:
 *   - vendor PSIRTs that publish RSS (Mozilla MFSA, Chrome Releases, VMware)
 *   - vendor PSIRTs that publish CVRF JSON (Microsoft MSRC, Cisco PSIRT)
 *   - vendor PSIRTs that publish HTML-only (Apple, Adobe, Schneider)
 * can all register as drop-in `FeedAdapter` instances in registry.ts without
 * the caller (briefScheduler / cyberSignals route) caring about format.
 */

import type { CyberSignalIngestInput } from "../cyberSignalValidation.js";

export type { CyberSignalIngestInput };

/**
 * Canonical signal_type taxonomy for ingest inputs. Mirrors the runtime
 * VALID_SIGNAL_TYPES set in cyberSignalValidation.ts. Adapters set the
 * default `signalType` field to one of these; per-item derivation inside
 * `toCyberSignal()` may override it (e.g. the threat-intel RSS adapters
 * route on title keywords).
 */
export type SignalType =
  | "cve"
  | "threat_actor"
  | "advisory"
  | "breach"
  | "patch"
  | "malware"
  | "geopolitical"
  | "regulatory_change"
  | "third_party_breach"
  | "data_exposure"
  | "patch_advisory"
  | "vulnerability";

/**
 * Tier classification of an upstream source.
 *
 *   1 — Authoritative (US-gov, vendor PSIRT, MITRE, NIST, ENISA).
 *   2 — Curated security press / SANS / well-attributed analysis.
 *   3 — General media touching security topics; high noise.
 *
 * Surfaced for downstream weighting and reporting; not consumed by the
 * adapter itself.
 */
export type SourceTier = 1 | 2 | 3;

/**
 * Format-agnostic feed contract.
 *
 * `fetch()` performs whatever I/O is appropriate for the source format
 * (HTTP GET + XML parse for RSS, HTTP GET + JSON parse for CVRF, etc.).
 * `toCyberSignal()` is pure — it receives one parsed item and returns
 * the validated ingest payload, or null if the item should be dropped
 * (relevance filter, missing title, etc.).
 *
 * Per-adapter `try/catch` is the responsibility of the caller
 * (`fetchAllFeeds()` in index.ts). Adapter implementations may throw
 * freely; the orchestrator isolates failures.
 */
export interface FeedAdapter<TItem = unknown> {
  /** Stable identifier — also used as the `source` field on emitted signals. */
  id: string;

  /** Authoritativeness classification. */
  sourceTier: SourceTier;

  /**
   * Default signal_type for this feed. Each emitted CyberSignalIngestInput
   * carries its own per-item signal_type returned by `toCyberSignal()`;
   * this field is metadata for registration, logging, and PSIRT routing.
   */
  signalType: SignalType;

  /**
   * Default vendor applied if `toCyberSignal()` does not derive a vendor
   * from the item content. Useful for vendor PSIRT feeds (e.g. all
   * Atlassian advisories implicitly target Atlassian products).
   * Threat-intel feeds and regulatory feeds leave this unset.
   */
  defaultVendor?: string;

  /** Pull and parse the upstream feed. Throws on network or parse failure. */
  fetch(): Promise<TItem[]>;

  /** Map a parsed item to a validated ingest payload, or null to drop. */
  toCyberSignal(item: TItem): CyberSignalIngestInput | null;
}

/**
 * Per-feed result envelope returned by `fetchAllFeeds()`. Mirrors the
 * shape produced by the legacy `fetchAllThreatIntelFeeds` /
 * `fetchRegulatoryFeeds` helpers so existing callers (briefScheduler,
 * /cyber-signals/fetch/* routes) can iterate the same way.
 */
export type FeedResult = {
  total: number;
  mapped: number;
  skipped: number;
  error?: string;
};

export type FetchAllFeedsResult = {
  signals: CyberSignalIngestInput[];
  results: Record<string, FeedResult>;
};

/**
 * Optional filter passed to `fetchAllFeeds()`. When set, only adapters whose
 * `id` is in `ids` will be polled; otherwise every registered adapter runs.
 */
export type FetchAllFeedsFilter = {
  ids?: string[];
};
