/**
 * regulatoryHelpers.ts — Pure mapping helpers for regulatory RSS feeds.
 *
 * Hosts the relevance filter, severity inference, and item-to-signal
 * mapping shared by the regulatory feeds (NIST news, FTC news). Relocated
 * from the legacy regulatoryFeedAdapter.ts — code is byte-identical so
 * existing assertions continue to hold.
 *
 * RELEVANCE FILTERING
 * Only items where the title OR description contains at least one
 * relevance keyword are returned as signals. This prevents noise from
 * unrelated NIST/FTC press releases (technology commercialisation,
 * consumer product recalls, etc.).
 *
 * SEVERITY DERIVATION
 *   title contains 'final rule' | 'enforcement' | 'breach' → 'High'
 *   (default)                                              → 'Moderate'
 */

import type { CyberSignalIngestInput } from "../cyberSignalValidation.js";

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

export type RegulatoryFeedItem = {
  title: string;
  description: string | null;
  link: string | null;
  guid: string | null;
  pubDate: string | null;
};

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
    affected_cve: null,
    // Per-item dedup discriminator. Regulatory signals carry no CVE/vendor, so
    // without this every item would hash identically and collapse to one row
    // per (source, signal_type). guid is the stable RSS id; link is the fallback.
    external_id: item.guid ?? item.link ?? null
  };
}
