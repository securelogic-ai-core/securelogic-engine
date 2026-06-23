/**
 * threatIntelHelpers.ts — Pure mapping helpers for threat-intel RSS feeds.
 *
 * Hosts the title-driven signal_type / severity / vendor / CVE / summary
 * derivation that the three threat-intel feeds (BleepingComputer, Krebs,
 * SANS ISC) share. Relocated from the legacy threatIntelRssAdapter.ts —
 * code is byte-identical so existing assertions continue to hold.
 *
 * SIGNAL TYPE DERIVATION (from title, case-insensitive)
 *   'breach' | 'hacked' | 'compromised'           → 'third_party_breach'
 *   'ransomware' | 'apt' | 'threat actor'          → 'threat_actor'
 *   'regulation' | 'compliance' | 'law' | 'rule'   → 'regulatory_change'
 *   'patch' | 'update' | 'advisory'               → 'patch_advisory'
 *   (default)                                      → 'patch_advisory'
 *
 * SEVERITY DERIVATION (from title, case-insensitive)
 *   'zero-day' | 'actively exploited' | 'nation-state' → 'Critical'
 *   'critical' | 'breach' | 'ransomware'               → 'High'
 *   (default)                                          → 'Moderate'
 *
 * VENDOR NAME MATCHING
 * Scans title against KNOWN_VENDORS lookup list (case-insensitive partial
 * match). Returns first matching vendor name or null.
 */

import type { CyberSignalIngestInput } from "../cyberSignalValidation.js";

/** Vendors to detect in article titles. */
export const KNOWN_VENDORS = [
  "Microsoft", "Google", "Apple", "Cisco", "Fortinet",
  "Palo Alto", "CrowdStrike", "Okta", "Salesforce",
  "AWS", "Azure", "VMware", "Ivanti", "MOVEit",
  "Progress Software", "SolarWinds", "GitLab",
  "GitHub", "Atlassian", "Citrix"
];

const CVE_RE = /CVE-\d{4}-\d{4,}/i;

const MAX_SUMMARY = 500;

/**
 * Derive signal_type from article title (keyword priority order).
 *
 * @example
 *   deriveRssSignalType("Company Hacked by Ransomware Gang")   → 'threat_actor'
 *   deriveRssSignalType("MOVEit Breach Impacts 200 Companies") → 'third_party_breach'
 *   deriveRssSignalType("New Patch Tuesday Fixes 60 Bugs")     → 'patch_advisory'
 */
export function deriveRssSignalType(
  title: string
): "third_party_breach" | "threat_actor" | "regulatory_change" | "patch_advisory" {
  const lower = title.toLowerCase();

  // Breach / intrusion signals checked first (high specificity)
  if (
    lower.includes("breach") ||
    lower.includes("hacked") ||
    lower.includes("compromised")
  ) {
    return "third_party_breach";
  }

  // Threat actor / campaign signals
  // Use \bapt to match "APT", "APT29", "APT-29" but not "laptop"
  if (
    lower.includes("ransomware") ||
    /\bapt/i.test(title) ||
    lower.includes("threat actor")
  ) {
    return "threat_actor";
  }

  // Regulatory / compliance signals
  if (
    lower.includes("regulation") ||
    lower.includes("compliance") ||
    lower.includes(" law ") ||
    lower.includes(" rule ")
  ) {
    return "regulatory_change";
  }

  // Patch / advisory signals
  if (
    lower.includes("patch") ||
    lower.includes("update") ||
    lower.includes("advisory")
  ) {
    return "patch_advisory";
  }

  return "patch_advisory";
}

/**
 * Derive severity from article title.
 *
 * Priority order (highest wins):
 *   'zero-day' | 'actively exploited' | 'nation-state' → 'Critical'
 *   'critical' | 'breach' | 'ransomware'               → 'High'
 *   (default)                                          → 'Moderate'
 */
export function deriveRssSeverity(
  title: string
): "Critical" | "High" | "Moderate" {
  const lower = title.toLowerCase();

  if (
    lower.includes("zero-day") ||
    lower.includes("zero day") ||
    lower.includes("actively exploited") ||
    lower.includes("nation-state") ||
    lower.includes("nation state")
  ) {
    return "Critical";
  }

  if (
    lower.includes("critical") ||
    lower.includes("breach") ||
    lower.includes("ransomware")
  ) {
    return "High";
  }

  return "Moderate";
}

/**
 * Scan an article title for a known vendor name.
 * Case-insensitive partial match. Returns the first match or null.
 */
export function extractRssVendor(title: string): string | null {
  const lower = title.toLowerCase();
  for (const vendor of KNOWN_VENDORS) {
    if (lower.includes(vendor.toLowerCase())) return vendor;
  }
  return null;
}

/**
 * Extract the first CVE ID from a text string. Returns null if absent.
 */
export function extractRssCve(text: string): string | null {
  const match = CVE_RE.exec(text);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Build normalized_summary from title + description.
 * Description is truncated to 300 characters before combining.
 * Combined result capped at MAX_SUMMARY (500) characters.
 */
export function buildRssNormalizedSummary(
  title: string,
  description: string | null
): string {
  if (!description) return title.slice(0, MAX_SUMMARY);
  const desc = description.slice(0, 300).trim();
  const full = `${title} — ${desc}`;
  return full.length > MAX_SUMMARY ? `${full.slice(0, MAX_SUMMARY - 3)}...` : full;
}

export type RssFeedItem = {
  title: string;
  description: string | null;
  link: string | null;
  guid: string | null;
  pubDate: string | null;
};

/**
 * Map a parsed RSS item to CyberSignalIngestInput for a given source slug.
 * Returns null if the item lacks a usable title.
 */
export function mapRssItemToSignal(
  item: RssFeedItem,
  source: string
): CyberSignalIngestInput | null {
  const title = item.title?.trim();
  if (!title) return null;

  const signalType = deriveRssSignalType(title);
  const severity = deriveRssSeverity(title);
  const affectedVendor = extractRssVendor(title);

  // CVE search covers title + description
  const searchText = `${title} ${item.description ?? ""}`;
  const affectedCve = extractRssCve(searchText);

  const normalizedSummary = buildRssNormalizedSummary(title, item.description);

  // Carry the canonical URL / guid in raw_payload for traceability.
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
    signal_type: signalType,
    severity,
    raw_payload: rawPayload,
    normalized_summary: normalizedSummary,
    affected_vendor: affectedVendor,
    affected_cve: affectedCve,
    // Per-item dedup discriminator. News items with no CVE/vendor in the title
    // would otherwise hash to an identical source|signal_type|| key and collapse
    // to one row. guid is the stable RSS id; link is the fallback. Two fetches of
    // the same article share a guid and still dedup correctly.
    external_id: item.guid ?? item.link ?? null
  };
}
