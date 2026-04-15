/**
 * threatIntelRssAdapter.ts — Generic threat intelligence RSS adapter.
 *
 * Supports three curated threat intelligence feeds:
 *   bleepingcomputer  — https://www.bleepingcomputer.com/feed/
 *   krebsonsecurity   — https://krebsonsecurity.com/feed/
 *   sans_isc          — https://isc.sans.edu/rssfeed_full.xml
 *
 * Each feed is source-isolated for deduplication: the same story from
 * BleepingComputer and Krebs will produce distinct signals (different source
 * slugs → different dedup hashes).
 *
 * SIGNAL TYPE DERIVATION (from title, case-insensitive)
 * -------------------------------------------------------
 *   'breach' | 'hacked' | 'compromised'           → 'third_party_breach'
 *   'ransomware' | 'apt' | 'threat actor'          → 'threat_actor'
 *   'regulation' | 'compliance' | 'law' | 'rule'   → 'regulatory_change'
 *   'patch' | 'update' | 'advisory'               → 'patch_advisory'
 *   (default)                                      → 'patch_advisory'
 *
 * SEVERITY DERIVATION (from title, case-insensitive)
 * ---------------------------------------------------
 *   'zero-day' | 'actively exploited' | 'nation-state' → 'Critical'
 *   'critical' | 'breach' | 'ransomware'               → 'High'
 *   (default)                                          → 'Moderate'
 *
 * VENDOR NAME MATCHING
 * --------------------
 * Scans title against KNOWN_VENDORS lookup list (case-insensitive partial match).
 * Returns first matching vendor name or null.
 *
 * DEDUPLICATION
 * -------------
 * The raw_payload includes the item URL/guid so the normalizer's dedup hash
 * incorporates the canonical URL — preventing the same article from being
 * re-inserted on subsequent fetches.
 *
 * PURE vs I/O BOUNDARY
 * --------------------
 * All derive/extract/build/map functions are pure and unit-testable.
 * fetchThreatIntelRss() and fetchAllThreatIntelFeeds() perform HTTP I/O.
 */

import type { CyberSignalIngestInput } from "./cyberSignalValidation.js";
import { extractRssItems, extractXmlField } from "./cisaAlertsAdapter.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Supported source slugs and their canonical RSS URLs. */
export const THREAT_INTEL_SOURCES: Record<string, string> = {
  bleepingcomputer: "https://www.bleepingcomputer.com/feed/",
  krebsonsecurity: "https://krebsonsecurity.com/feed/",
  sans_isc: "https://isc.sans.edu/rssfeed_full.xml"
};

export const VALID_THREAT_INTEL_SOURCES = new Set(
  Object.keys(THREAT_INTEL_SOURCES)
);

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

// ---------------------------------------------------------------------------
// Pure derivation functions
// ---------------------------------------------------------------------------

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
 *
 * @example
 *   extractRssVendor("Microsoft Patches 80 Vulnerabilities in July Update") → "Microsoft"
 *   extractRssVendor("Threat Actor Targets Financial Services Sector")       → null
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RssFeedItem = {
  title: string;
  description: string | null;
  link: string | null;
  guid: string | null;
  pubDate: string | null;
};

// ---------------------------------------------------------------------------
// mapRssItemToSignal  (pure)
// ---------------------------------------------------------------------------

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

  // Include canonical URL in raw_payload so the dedup hash incorporates it.
  // Two fetches of the same article from the same source will hash identically.
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
    affected_cve: affectedCve
  };
}

// ---------------------------------------------------------------------------
// fetchThreatIntelRss  (I/O)
// ---------------------------------------------------------------------------

/**
 * Fetch a single threat intel RSS feed and return mapped signals.
 *
 * @param source  Source slug (must be a key in THREAT_INTEL_SOURCES)
 * @param url     RSS feed URL
 */
export async function fetchThreatIntelRss(
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
      "User-Agent": "SecureLogic-AI/1.0 (Threat Intel RSS Adapter)"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Threat intel RSS fetch failed [${source}]: HTTP ${response.status} ${response.statusText}`
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

    const item: RssFeedItem = { title, description, link, guid, pubDate };
    const mapped = mapRssItemToSignal(item, source);

    if (mapped === null) {
      skipped++;
      continue;
    }

    signals.push(mapped);
  }

  return { signals, total: itemXmls.length, skipped };
}

// ---------------------------------------------------------------------------
// fetchAllThreatIntelFeeds  (I/O)
// ---------------------------------------------------------------------------

/**
 * Fetch all specified threat intel RSS sources (or all if none specified).
 * Failures for individual sources are isolated — other sources continue.
 *
 * @param sources  Optional array of source slugs to fetch (default: all three).
 * @returns        Flat list of all signals + per-source result summary.
 */
export async function fetchAllThreatIntelFeeds(
  sources?: string[]
): Promise<{
  signals: CyberSignalIngestInput[];
  results: Record<string, { total: number; mapped: number; skipped: number; error?: string }>;
}> {
  const targetSources = (sources ?? Object.keys(THREAT_INTEL_SOURCES)).filter(
    (s) => VALID_THREAT_INTEL_SOURCES.has(s)
  );

  const allSignals: CyberSignalIngestInput[] = [];
  const results: Record<
    string,
    { total: number; mapped: number; skipped: number; error?: string }
  > = {};

  for (const source of targetSources) {
    const url = THREAT_INTEL_SOURCES[source];
    if (!url) continue;

    try {
      const { signals, total, skipped } = await fetchThreatIntelRss(source, url);
      allSignals.push(...signals);
      results[source] = { total, mapped: signals.length, skipped };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results[source] = { total: 0, mapped: 0, skipped: 0, error: errorMsg };
    }
  }

  return { signals: allSignals, results };
}
