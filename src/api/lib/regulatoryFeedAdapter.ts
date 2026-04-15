/**
 * regulatoryFeedAdapter.ts — Regulatory and compliance news RSS adapter.
 *
 * Monitors authoritative government and standards-body feeds for regulatory
 * changes relevant to enterprise security and compliance posture:
 *
 *   nist_news  — NIST news feed (cybersecurity frameworks, standards, guidance)
 *   ftc_news   — FTC news feed (enforcement actions, privacy rulings, breach notices)
 *
 * RELEVANCE FILTERING
 * -------------------
 * Only items where the title OR description contains at least one relevance
 * keyword are returned as signals. Items with no keyword match are skipped.
 * This prevents noise from unrelated NIST/FTC press releases (technology
 * commercialisation, consumer product recalls, etc.).
 *
 * Relevance keywords:
 *   cybersecurity | data | privacy | breach | security | cyber |
 *   ransomware | risk | compliance
 *
 * SEVERITY DERIVATION
 * -------------------
 *   title contains 'final rule' | 'enforcement' | 'breach' → 'High'
 *   (default)                                              → 'Moderate'
 *
 * PURE vs I/O BOUNDARY
 * --------------------
 * All is/derive/build/map functions are pure and unit-testable.
 * fetchRegulatoryFeed() and fetchRegulatoryFeeds() perform HTTP I/O.
 */

import type { CyberSignalIngestInput } from "./cyberSignalValidation.js";
import { extractRssItems, extractXmlField } from "./cisaAlertsAdapter.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REGULATORY_SOURCES: Record<string, string> = {
  nist_news: "https://www.nist.gov/news-events/news/rss.xml",
  ftc_news: "https://www.ftc.gov/rss/news.xml"
};

/** Keywords that qualify a regulatory item as cybersecurity-relevant. */
export const RELEVANCE_KEYWORDS = [
  "cybersecurity",
  "data",
  "privacy",
  "breach",
  "security",
  "cyber",
  "ransomware",
  "risk",
  "compliance"
];

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Return true if the item text contains at least one relevance keyword.
 * Both title and description are checked (case-insensitive).
 */
export function isRegulatoryItemRelevant(
  title: string,
  description: string | null
): boolean {
  const haystack = `${title} ${description ?? ""}`.toLowerCase();
  for (const keyword of RELEVANCE_KEYWORDS) {
    if (haystack.includes(keyword)) return true;
  }
  return false;
}

/**
 * Derive severity from regulatory item title.
 *   'final rule' | 'enforcement' | 'breach' → 'High'
 *   default                                 → 'Moderate'
 */
export function deriveRegulatorySeverity(
  title: string
): "High" | "Moderate" {
  const lower = title.toLowerCase();
  if (
    lower.includes("final rule") ||
    lower.includes("enforcement") ||
    lower.includes("breach")
  ) {
    return "High";
  }
  return "Moderate";
}

/**
 * Build normalized_summary: title + first 300 chars of description.
 * Capped at 500 characters total.
 */
export function buildRegulatoryNormalizedSummary(
  title: string,
  description: string | null
): string {
  if (!description) return title.slice(0, 500);
  const desc = description.slice(0, 300).trim();
  const full = `${title} — ${desc}`;
  return full.length > 500 ? `${full.slice(0, 497)}...` : full;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegulatoryFeedItem = {
  title: string;
  description: string | null;
  link: string | null;
  guid: string | null;
  pubDate: string | null;
};

// ---------------------------------------------------------------------------
// mapRegulatoryItemToSignal  (pure)
// ---------------------------------------------------------------------------

/**
 * Map a parsed regulatory feed item to CyberSignalIngestInput.
 * Returns null if the item is not relevant or lacks a title.
 */
export function mapRegulatoryItemToSignal(
  item: RegulatoryFeedItem,
  source: string
): CyberSignalIngestInput | null {
  const title = item.title?.trim();
  if (!title) return null;

  if (!isRegulatoryItemRelevant(title, item.description)) return null;

  const severity = deriveRegulatorySeverity(title);
  const normalizedSummary = buildRegulatoryNormalizedSummary(
    title,
    item.description
  );

  const rawPayload: Record<string, unknown> = {
    title,
    description: item.description,
    link: item.link,
    guid: item.guid,
    pubDate: item.pubDate,
    source
  };

  return {
    source,
    signal_type: "regulatory_change",
    severity,
    raw_payload: rawPayload,
    normalized_summary: normalizedSummary,
    affected_vendor: null,   // regulatory signals are org-wide, not vendor-specific
    affected_cve: null
  };
}

// ---------------------------------------------------------------------------
// fetchRegulatoryFeed  (I/O)
// ---------------------------------------------------------------------------

/**
 * Fetch a single regulatory RSS feed and return mapped signals.
 * Irrelevant items (no keyword match) are silently skipped.
 */
export async function fetchRegulatoryFeed(
  source: string,
  url: string
): Promise<{
  signals: CyberSignalIngestInput[];
  total: number;
  skipped: number;
}> {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/rss+xml, application/xml, text/xml",
      "User-Agent": "SecureLogic-AI/1.0 (Regulatory Feed Adapter)"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Regulatory feed fetch failed [${source}]: HTTP ${response.status} ${response.statusText}`
    );
  }

  const xml = await response.text();
  const itemXmls = extractRssItems(xml);

  const signals: CyberSignalIngestInput[] = [];
  let skipped = 0;

  for (const itemXml of itemXmls) {
    const title = extractXmlField(itemXml, "title");
    const description = extractXmlField(itemXml, "description");
    const link = extractXmlField(itemXml, "link");
    const guid = extractXmlField(itemXml, "guid");
    const pubDate = extractXmlField(itemXml, "pubDate");

    if (!title) {
      skipped++;
      continue;
    }

    const item: RegulatoryFeedItem = { title, description, link, guid, pubDate };
    const mapped = mapRegulatoryItemToSignal(item, source);

    if (mapped === null) {
      skipped++;
      continue;
    }

    signals.push(mapped);
  }

  return { signals, total: itemXmls.length, skipped };
}

// ---------------------------------------------------------------------------
// fetchRegulatoryFeeds  (I/O)
// ---------------------------------------------------------------------------

/**
 * Fetch both regulatory feeds (NIST + FTC) with error isolation.
 * A failure in one feed does not block the other.
 */
export async function fetchRegulatoryFeeds(): Promise<{
  signals: CyberSignalIngestInput[];
  results: Record<string, { total: number; mapped: number; skipped: number; error?: string }>;
}> {
  const allSignals: CyberSignalIngestInput[] = [];
  const results: Record<
    string,
    { total: number; mapped: number; skipped: number; error?: string }
  > = {};

  for (const [source, url] of Object.entries(REGULATORY_SOURCES)) {
    try {
      const { signals, total, skipped } = await fetchRegulatoryFeed(source, url);
      allSignals.push(...signals);
      results[source] = { total, mapped: signals.length, skipped };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results[source] = { total: 0, mapped: 0, skipped: 0, error: errorMsg };
    }
  }

  return { signals: allSignals, results };
}
