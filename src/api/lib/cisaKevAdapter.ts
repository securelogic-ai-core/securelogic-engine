/**
 * cisaKevAdapter.ts — CISA Known Exploited Vulnerabilities adapter.
 *
 * Fetches the CISA KEV JSON feed and maps each entry to the platform's
 * CyberSignalIngestInput format, ready for the ingest pipeline.
 *
 * CISA KEV FEED
 * -------------
 * Public JSON at:
 *   https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 *
 * Top-level shape:
 *   { title, catalogVersion, dateReleased, count, vulnerabilities: CisaKevEntry[] }
 *
 * All entries are actively exploited CVEs. CISA does not include CVSS scores in
 * the feed — the severity is derived from a cvssScore field if present in the
 * entry (some enriched exports include it), otherwise defaults to 'High'. The
 * 'High' floor is justified: CISA KEV inclusion requires active exploitation in
 * the wild, which is at minimum a High-severity signal regardless of base CVSS.
 *
 * SIGNAL_TYPE
 * -----------
 * All CISA KEV entries are CVEs. signal_type is set to 'cve' (the canonical
 * platform type for CVE-identified vulnerabilities).
 *
 * SOURCE
 * ------
 * source is set to 'cisa_kev' to distinguish from generic 'cisa' signals and
 * allow dedup isolation per source.
 *
 * PURE vs I/O BOUNDARY
 * --------------------
 * mapKevEntryToSignal() — pure, no I/O, fully unit-testable.
 * fetchCisaKevSignals() — performs the HTTP fetch, calls mapKevEntryToSignal.
 */

import type { CyberSignalIngestInput } from "./cyberSignalValidation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a single entry in the CISA KEV vulnerabilities array */
export type CisaKevEntry = {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  notes?: string;
  /** Optional — present in some enriched exports */
  cvssScore?: number | string | null;
};

/** Top-level shape of the CISA KEV JSON feed */
type CisaKevFeed = {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  count: number;
  vulnerabilities: CisaKevEntry[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CISA_KEV_FEED_URL =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

const CVE_RE = /^CVE-\d{4}-\d{4,}$/i;

// ---------------------------------------------------------------------------
// deriveSeverityFromCvss
// ---------------------------------------------------------------------------

/**
 * Map a CVSS base score (0–10) to a platform severity label.
 *
 * Thresholds follow the CVSS v3 qualitative severity ratings:
 *   >= 9.0  → Critical
 *   >= 7.0  → High
 *   >= 4.0  → Moderate
 *    < 4.0  → Low
 *
 * Returns null if the input is absent, non-numeric, or out of range.
 * The caller should fall back to 'High' when null is returned.
 */
export function deriveSeverityFromCvss(
  cvssScore: number | string | null | undefined
): "Critical" | "High" | "Moderate" | "Low" | null {
  if (cvssScore === null || cvssScore === undefined) return null;

  const score = typeof cvssScore === "string" ? parseFloat(cvssScore) : cvssScore;
  if (!Number.isFinite(score) || score < 0 || score > 10) return null;

  if (score >= 9.0) return "Critical";
  if (score >= 7.0) return "High";
  if (score >= 4.0) return "Moderate";
  return "Low";
}

// ---------------------------------------------------------------------------
// buildNormalizedSummary
// ---------------------------------------------------------------------------

/**
 * Build a normalized summary from the CISA KEV entry fields.
 *
 * Format: "<vulnerabilityName> — <vendorProject> <product>"
 * If vulnerabilityName is absent or empty, shortDescription is used instead.
 * The result is truncated to 500 characters to match the normalizer limit.
 */
export function buildKevNormalizedSummary(entry: CisaKevEntry): string {
  const description =
    entry.vulnerabilityName?.trim() || entry.shortDescription?.trim() || "";

  const vendor = entry.vendorProject?.trim() || "";
  const product = entry.product?.trim() || "";

  const entityPart =
    vendor && product
      ? `${vendor} ${product}`
      : vendor || product;

  const full = entityPart
    ? `${description} — ${entityPart}`
    : description;

  return full.length > 500 ? `${full.slice(0, 497)}...` : full;
}

// ---------------------------------------------------------------------------
// mapKevEntryToSignal  (pure)
// ---------------------------------------------------------------------------

/**
 * Map a single CISA KEV entry to the platform's CyberSignalIngestInput shape.
 *
 * Returns null for entries that cannot be mapped cleanly:
 *   - cveID absent or not matching CVE-YYYY-NNNNN format (unparseable entries)
 *
 * The caller should skip null results and continue with the rest of the batch.
 */
export function mapKevEntryToSignal(
  entry: CisaKevEntry
): CyberSignalIngestInput | null {
  // Validate CVE ID — entries without a valid CVE ID are skipped.
  const cveRaw = entry.cveID?.trim().toUpperCase() ?? "";
  if (!CVE_RE.test(cveRaw)) return null;

  const cvss = deriveSeverityFromCvss(entry.cvssScore);
  const severity: "Critical" | "High" | "Moderate" | "Low" = cvss ?? "High";

  const normalizedSummary = buildKevNormalizedSummary(entry);

  const affectedVendor = entry.vendorProject?.trim() || null;

  return {
    source: "cisa_kev",
    signal_type: "cve",
    severity,
    raw_payload: entry as unknown as Record<string, unknown>,
    normalized_summary: normalizedSummary || null,
    affected_vendor: affectedVendor,
    affected_cve: cveRaw
  };
}

// ---------------------------------------------------------------------------
// fetchCisaKevSignals  (I/O)
// ---------------------------------------------------------------------------

/**
 * Fetch the CISA KEV feed and return mapped signal inputs.
 *
 * - Skips entries that fail mapKevEntryToSignal (malformed CVE IDs).
 * - Does not validate against VALID_SOURCES / VALID_SIGNAL_TYPES — that is
 *   the ingest pipeline's responsibility.
 * - Throws on network errors or malformed JSON so the caller can handle them.
 */
export async function fetchCisaKevSignals(): Promise<{
  signals: CyberSignalIngestInput[];
  total: number;
  skipped: number;
}> {
  const response = await fetch(CISA_KEV_FEED_URL, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "SecureLogic-AI/1.0 (CISA KEV Adapter)"
    }
  });

  if (!response.ok) {
    throw new Error(
      `CISA KEV fetch failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const feed = (await response.json()) as CisaKevFeed;

  if (!Array.isArray(feed.vulnerabilities)) {
    throw new Error(
      "CISA KEV feed malformed: vulnerabilities array missing"
    );
  }

  const signals: CyberSignalIngestInput[] = [];
  let skipped = 0;

  for (const entry of feed.vulnerabilities) {
    const mapped = mapKevEntryToSignal(entry);
    if (mapped === null) {
      skipped++;
      continue;
    }
    signals.push(mapped);
  }

  return {
    signals,
    total: feed.vulnerabilities.length,
    skipped
  };
}
