/**
 * cisaAlertsAdapter.ts — CISA Cybersecurity Advisories RSS adapter.
 *
 * Fetches the CISA all-advisories RSS feed and maps each item to the platform's
 * CyberSignalIngestInput format. Complements cisaKevAdapter (CVE-only) by
 * covering CISA's broader advisory surface: ICS advisories, nation-state alerts,
 * ransomware advisories, vendor patch guidance, and critical infrastructure alerts.
 *
 * RSS FEED
 * --------
 * https://www.cisa.gov/cybersecurity-advisories/all.xml
 *
 * The feed is standard RSS 2.0 with items wrapped in CDATA.
 *
 * SIGNAL TYPE DERIVATION
 * ----------------------
 * Derived from item title (case-insensitive keyword matching):
 *   'ransomware'                     → 'threat_actor'
 *   'nation' | 'apt' | 'state'       → 'threat_actor'
 *   'advisory' | 'alert'             → 'patch_advisory'
 *   (default)                        → 'patch_advisory'
 *
 * SEVERITY DERIVATION
 * -------------------
 *   title contains 'critical' or 'actively exploited' → 'Critical'
 *   (default)                                         → 'High'
 *
 * CISA advisories are always High floor — CISA only publishes actionable
 * alerts that represent meaningful risk.
 *
 * PURE vs I/O BOUNDARY
 * --------------------
 * All derive/extract/build/map functions are pure and unit-testable.
 * fetchCisaAlerts() performs HTTP I/O.
 */

import type { CyberSignalIngestInput } from "./cyberSignalValidation.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CISA_ALERTS_FEED_URL =
  "https://www.cisa.gov/cybersecurity-advisories/all.xml";

/** Vendor names to scan for in advisory titles. */
const KNOWN_VENDORS = [
  "Cisco", "Fortinet", "Palo Alto", "Ivanti", "Microsoft", "Apple",
  "Google", "VMware", "Citrix", "F5", "Juniper", "SonicWall", "Pulse",
  "MOVEit", "Progress Software", "SolarWinds", "GitLab", "Atlassian"
];

const CVE_RE = /CVE-\d{4}-\d{4,}/i;

// ---------------------------------------------------------------------------
// XML parsing helpers (no external library)
// ---------------------------------------------------------------------------

/**
 * Extract all <item> blocks from an RSS feed string.
 * Handles both plain content and CDATA-wrapped values.
 */
export function extractRssItems(xml: string): string[] {
  const items: string[] = [];
  // Match everything between <item> and </item> (non-greedy)
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null) {
    items.push(match[1]!);
  }
  return items;
}

/**
 * Extract text content of a named XML tag from an item string.
 * Handles CDATA: <tag><![CDATA[value]]></tag>
 * Also handles plain: <tag>value</tag>
 * Returns null if the tag is absent.
 */
export function extractXmlField(itemXml: string, tag: string): string | null {
  // CDATA form first
  const cdataRe = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "i"
  );
  const cdataMatch = cdataRe.exec(itemXml);
  if (cdataMatch) return cdataMatch[1]!.trim();

  // Plain form
  const plainRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const plainMatch = plainRe.exec(itemXml);
  if (plainMatch) return plainMatch[1]!.trim();

  return null;
}

// ---------------------------------------------------------------------------
// Pure derivation functions
// ---------------------------------------------------------------------------

/**
 * Derive signal_type from advisory title.
 *
 * @example
 *   deriveAlertSignalType("CISA Warns of Ransomware Exploiting...")  → 'threat_actor'
 *   deriveAlertSignalType("Cisco IOS Advisory")                      → 'patch_advisory'
 */
export function deriveAlertSignalType(
  title: string
): "threat_actor" | "patch_advisory" {
  const lower = title.toLowerCase();
  if (lower.includes("ransomware")) return "threat_actor";
  if (
    lower.includes("nation") ||
    /\bapt/i.test(title) ||
    lower.includes("state-sponsored") ||
    lower.includes("state sponsored")
  ) {
    return "threat_actor";
  }
  return "patch_advisory";
}

/**
 * Derive severity from advisory title.
 * 'Critical' if the title contains 'critical' or 'actively exploited'.
 * 'High' otherwise — CISA advisories are never below High.
 */
export function deriveAlertSeverity(
  title: string
): "Critical" | "High" {
  const lower = title.toLowerCase();
  if (lower.includes("critical") || lower.includes("actively exploited")) {
    return "Critical";
  }
  return "High";
}

/**
 * Extract the first CVE ID (CVE-YYYY-NNNNN) from a text string.
 * Returns null if none found.
 */
export function extractCveFromText(text: string): string | null {
  const match = CVE_RE.exec(text);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Scan an advisory title for a known vendor name.
 * Case-insensitive partial match. Returns the first match or null.
 *
 * @example
 *   extractVendorFromTitle("Cisco IOS Advisory: Remote Code Execution") → "Cisco"
 *   extractVendorFromTitle("Multiple Vulnerabilities in Web Servers")    → null
 */
export function extractVendorFromTitle(title: string): string | null {
  const lower = title.toLowerCase();
  for (const vendor of KNOWN_VENDORS) {
    if (lower.includes(vendor.toLowerCase())) return vendor;
  }
  return null;
}

/**
 * Build the normalized_summary: title + truncated description.
 * Total capped at 500 characters.
 */
export function buildAlertNormalizedSummary(
  title: string,
  description: string | null
): string {
  if (!description) return title.slice(0, 500);
  const desc = description.slice(0, 300).trim();
  const full = `${title} — ${desc}`;
  return full.length > 500 ? `${full.slice(0, 497)}...` : full;
}

// ---------------------------------------------------------------------------
// mapAlertItemToSignal  (pure)
// ---------------------------------------------------------------------------

export type CisaAlertItem = {
  title: string;
  description: string | null;
  link: string | null;
  guid: string | null;
};

/**
 * Map a parsed CISA advisory RSS item to CyberSignalIngestInput.
 * Returns null if the item lacks a usable title.
 */
export function mapAlertItemToSignal(
  item: CisaAlertItem
): CyberSignalIngestInput | null {
  const title = item.title?.trim();
  if (!title) return null;

  const signalType = deriveAlertSignalType(title);
  const severity = deriveAlertSeverity(title);
  const affectedVendor = extractVendorFromTitle(title);

  const descriptionText = item.description ?? "";
  const affectedCve = extractCveFromText(descriptionText) ??
    extractCveFromText(title);

  const normalizedSummary = buildAlertNormalizedSummary(title, item.description);

  const rawPayload: Record<string, unknown> = {
    title,
    description: item.description,
    link: item.link,
    guid: item.guid
  };

  return {
    source: "cisa_alerts",
    signal_type: signalType,
    severity,
    raw_payload: rawPayload,
    normalized_summary: normalizedSummary,
    affected_vendor: affectedVendor,
    affected_cve: affectedCve
  };
}

// ---------------------------------------------------------------------------
// fetchCisaAlerts  (I/O)
// ---------------------------------------------------------------------------

/**
 * Fetch the CISA cybersecurity advisories RSS feed and return mapped signals.
 *
 * Throws on network errors or unparseable responses.
 * Returns { signals, total, skipped } where total = raw item count.
 */
export async function fetchCisaAlerts(): Promise<{
  signals: CyberSignalIngestInput[];
  total: number;
  skipped: number;
}> {
  const response = await fetch(CISA_ALERTS_FEED_URL, {
    headers: {
      "Accept": "application/rss+xml, application/xml, text/xml",
      "User-Agent": "SecureLogic-AI/1.0 (CISA Alerts Adapter)"
    }
  });

  if (!response.ok) {
    throw new Error(
      `CISA Alerts fetch failed: HTTP ${response.status} ${response.statusText}`
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

    if (!title) {
      skipped++;
      continue;
    }

    const item: CisaAlertItem = { title, description, link, guid };
    const mapped = mapAlertItemToSignal(item);

    if (mapped === null) {
      skipped++;
      continue;
    }

    signals.push(mapped);
  }

  return {
    signals,
    total: itemXmls.length,
    skipped
  };
}
