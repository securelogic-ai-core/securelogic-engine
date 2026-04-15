/**
 * nvdAdapter.ts — National Vulnerability Database (NVD) CVE adapter.
 *
 * Fetches recent CVEs from the NVD REST API 2.0 and maps each entry to the
 * platform's CyberSignalIngestInput format, ready for the ingest pipeline.
 *
 * NVD API
 * -------
 * Endpoint: https://services.nvd.nist.gov/rest/json/cves/2.0
 *
 * Query parameters used:
 *   pubStartDate   — ISO 8601: 2024-01-01T00:00:00.000 (NVD treats as UTC)
 *   pubEndDate     — ISO 8601: 2024-01-08T00:00:00.000
 *   resultsPerPage — max 2000 (used to minimise page count)
 *   startIndex     — 0-based offset for pagination
 *
 * Optional: NVD_API_KEY env var — raises rate limit from 5 req/30s to 50 req/30s.
 *
 * RATE LIMITING
 * -------------
 * Without an API key: 5 requests per rolling 30 seconds.
 * A 600ms inter-page delay is applied between paginated requests. For typical
 * 7-day windows (usually ≤ 2000 CVEs = one page), no delay is incurred.
 * For large windows with multiple pages, set NVD_API_KEY to raise the rate limit.
 *
 * SEVERITY DERIVATION
 * -------------------
 * Priority order:
 *   1. cvssMetricV31[type=Primary].cvssData.baseScore
 *   2. cvssMetricV31[0].cvssData.baseScore  (any metric)
 *   3. cvssMetricV30[type=Primary].cvssData.baseScore
 *   4. cvssMetricV30[0].cvssData.baseScore
 *   5. cvssMetricV2[type=Primary].cvssData.baseScore
 *   6. cvssMetricV2[0].cvssData.baseScore
 *   7. 'Moderate' (default — NVD CVEs without scores are typically newly published)
 *
 * VENDOR EXTRACTION
 * -----------------
 * Parses the first vulnerable CPE 2.3 string from cve.configurations.
 * CPE format: cpe:2.3:type:VENDOR:product:version:...
 * Underscores in vendor/product names are converted to spaces.
 * Returns null if configurations are absent or unparseable.
 *
 * PURE vs I/O BOUNDARY
 * --------------------
 * All functions except fetchNvdSignals() are pure and fully unit-testable.
 * fetchNvdSignals() performs HTTP requests and applies inter-page delays.
 */

import type { CyberSignalIngestInput } from "./cyberSignalValidation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NvdCvssData = {
  version: string;
  vectorString?: string;
  baseScore: number;
  baseSeverity?: string;
};

export type NvdCvssMetric = {
  source: string;
  type: string;
  cvssData: NvdCvssData;
};

export type NvdCpeMatch = {
  vulnerable: boolean;
  criteria: string;
  matchCriteriaId?: string;
  versionStartIncluding?: string;
  versionEndExcluding?: string;
};

export type NvdNode = {
  operator: string;
  negate: boolean;
  cpeMatch?: NvdCpeMatch[];
  nodes?: NvdNode[];
};

export type NvdConfiguration = {
  nodes: NvdNode[];
};

export type NvdDescription = {
  lang: string;
  value: string;
};

export type NvdCve = {
  id: string;
  sourceIdentifier?: string;
  published: string;
  lastModified: string;
  vulnStatus?: string;
  descriptions: NvdDescription[];
  metrics?: {
    cvssMetricV31?: NvdCvssMetric[];
    cvssMetricV30?: NvdCvssMetric[];
    cvssMetricV2?: NvdCvssMetric[];
  };
  configurations?: NvdConfiguration[];
  references?: Array<{ url: string; source?: string; tags?: string[] }>;
  weaknesses?: Array<{
    source: string;
    type: string;
    description: Array<{ lang: string; value: string }>;
  }>;
};

export type NvdVulnerability = {
  cve: NvdCve;
};

export type NvdApiResponse = {
  resultsPerPage: number;
  startIndex: number;
  totalResults: number;
  format: string;
  version: string;
  timestamp: string;
  vulnerabilities: NvdVulnerability[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const NVD_API_BASE_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";

/** Results per page — NVD max is 2000. */
const RESULTS_PER_PAGE = 2000;

/** Delay between paginated requests to respect NVD rate limits. */
const INTER_PAGE_DELAY_MS = 600;

const CVE_RE = /^CVE-\d{4}-\d{4,}$/i;

// ---------------------------------------------------------------------------
// severityFromScore (pure, local)
// ---------------------------------------------------------------------------

/**
 * Map a CVSS base score (0–10) to a platform severity label.
 * Returns null for absent, non-numeric, or out-of-range values.
 *
 * CVSS v3 qualitative thresholds:
 *   >= 9.0 → Critical | >= 7.0 → High | >= 4.0 → Moderate | < 4.0 → Low
 */
function severityFromScore(
  score: number | null | undefined
): "Critical" | "High" | "Moderate" | "Low" | null {
  if (score === null || score === undefined) return null;
  if (!Number.isFinite(score) || score < 0 || score > 10) return null;
  if (score >= 9.0) return "Critical";
  if (score >= 7.0) return "High";
  if (score >= 4.0) return "Moderate";
  return "Low";
}

// ---------------------------------------------------------------------------
// selectMetric (pure)
// ---------------------------------------------------------------------------

/**
 * From an array of CVSS metrics (v3.1, v3.0, or v2), prefer the one typed
 * 'Primary'. Falls back to the first metric in the array.
 */
function selectMetric(metrics: NvdCvssMetric[] | undefined): NvdCvssMetric | null {
  if (!metrics || metrics.length === 0) return null;
  return metrics.find((m) => m.type === "Primary") ?? metrics[0] ?? null;
}

// ---------------------------------------------------------------------------
// extractNvdSeverity (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Derive a platform severity label from the CVE's CVSS metrics.
 *
 * Preference order: cvssMetricV31 → cvssMetricV30 → cvssMetricV2 → 'Moderate'.
 * Within each version, the 'Primary' metric source is preferred over others.
 */
export function extractNvdSeverity(
  cve: NvdCve
): "Critical" | "High" | "Moderate" | "Low" {
  const m = cve.metrics;
  if (!m) return "Moderate";

  for (const versionKey of ["cvssMetricV31", "cvssMetricV30", "cvssMetricV2"] as const) {
    const metric = selectMetric(m[versionKey]);
    if (metric) {
      const derived = severityFromScore(metric.cvssData.baseScore);
      if (derived) return derived;
    }
  }

  return "Moderate";
}

// ---------------------------------------------------------------------------
// extractNvdEnDescription (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Extract the English description from a CVE's descriptions array.
 * Returns null if no English description is present or the value is empty.
 */
export function extractNvdEnDescription(cve: NvdCve): string | null {
  if (!Array.isArray(cve.descriptions)) return null;
  const en = cve.descriptions.find((d) => d.lang === "en");
  const val = en?.value?.trim() ?? "";
  return val.length > 0 ? val : null;
}

// ---------------------------------------------------------------------------
// parseCpeVendor (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse a CPE 2.3 string and return the vendor component.
 *
 * CPE 2.3 format: cpe:2.3:type:vendor:product:version:...
 *   - component index 0: "cpe"
 *   - component index 1: "2.3"
 *   - component index 2: part ("a" | "o" | "h")
 *   - component index 3: vendor  ← extracted here
 *   - component index 4: product
 *
 * Underscores in the vendor component are replaced with spaces.
 * Returns null for wildcard ("*"), NA ("-"), or unparseable strings.
 *
 * @example
 *   parseCpeVendor("cpe:2.3:a:microsoft:windows_10:21h2:*:*:*:*:*:*:*")
 *   // "microsoft"
 *   parseCpeVendor("cpe:2.3:a:palo_alto_networks:pan-os:*:*:*:*:*:*:*:*")
 *   // "palo alto networks"
 */
export function parseCpeVendor(criteria: string): string | null {
  if (typeof criteria !== "string" || !criteria.startsWith("cpe:")) return null;

  // CPE 2.3 components are colon-delimited. Vendor names do not contain
  // unescaped colons, so simple split is correct for the vendor field.
  const parts = criteria.split(":");
  if (parts.length < 5) return null;

  const vendor = parts[3]!.trim();
  if (!vendor || vendor === "*" || vendor === "-") return null;

  // Replace underscores with spaces for readability.
  return vendor.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// extractNvdVendor (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Extract the primary affected vendor from a CVE's configurations.
 *
 * Walks configuration nodes (depth-first) to find the first CPE match
 * where vulnerable=true. Returns the parsed vendor component.
 * Returns null if configurations are absent, empty, or contain no
 * parseable CPE strings.
 */
export function extractNvdVendor(cve: NvdCve): string | null {
  if (!Array.isArray(cve.configurations) || cve.configurations.length === 0) {
    return null;
  }

  for (const config of cve.configurations) {
    const vendor = extractVendorFromNodes(config.nodes);
    if (vendor) return vendor;
  }

  return null;
}

function extractVendorFromNodes(nodes: NvdNode[]): string | null {
  for (const node of nodes) {
    // Check direct cpeMatch entries
    if (Array.isArray(node.cpeMatch)) {
      for (const match of node.cpeMatch) {
        if (match.vulnerable) {
          const vendor = parseCpeVendor(match.criteria);
          if (vendor) return vendor;
        }
      }
    }
    // Recurse into child nodes
    if (Array.isArray(node.nodes) && node.nodes.length > 0) {
      const vendor = extractVendorFromNodes(node.nodes);
      if (vendor) return vendor;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// buildNvdNormalizedSummary (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build a normalized summary string from the CVE.
 *
 * Uses the English description, truncated to 500 characters.
 * Returns null if no English description is available.
 */
export function buildNvdNormalizedSummary(cve: NvdCve): string | null {
  const description = extractNvdEnDescription(cve);
  if (!description) return null;
  return description.length > 500
    ? `${description.slice(0, 497)}...`
    : description;
}

// ---------------------------------------------------------------------------
// mapNvdCveToSignal (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Map a single NVD vulnerability entry to the platform's CyberSignalIngestInput.
 *
 * Returns null for entries that cannot be mapped cleanly:
 *   - CVE ID absent or not matching CVE-YYYY-NNNNN format
 *
 * The caller should skip null results and continue with the rest of the batch.
 */
export function mapNvdCveToSignal(
  vuln: NvdVulnerability
): CyberSignalIngestInput | null {
  const cve = vuln?.cve;
  if (!cve) return null;

  const cveRaw = cve.id?.trim().toUpperCase() ?? "";
  if (!CVE_RE.test(cveRaw)) return null;

  const severity = extractNvdSeverity(cve);
  const normalizedSummary = buildNvdNormalizedSummary(cve);
  const affectedVendor = extractNvdVendor(cve);

  return {
    source: "nvd",
    signal_type: "cve",
    severity,
    raw_payload: cve as unknown as Record<string, unknown>,
    normalized_summary: normalizedSummary,
    affected_vendor: affectedVendor,
    affected_cve: cveRaw
  };
}

// ---------------------------------------------------------------------------
// formatNvdDate (pure, local)
// ---------------------------------------------------------------------------

/**
 * Format a Date as NVD's required ISO 8601 string: YYYY-MM-DDTHH:mm:ss.SSS
 * NVD does not use timezone suffix — it interprets the value as UTC.
 */
function formatNvdDate(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `.${pad(d.getUTCMilliseconds(), 3)}`
  );
}

// ---------------------------------------------------------------------------
// sleep (local)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// fetchNvdPage (I/O, local)
// ---------------------------------------------------------------------------

async function fetchNvdPage(
  pubStartDate: string,
  pubEndDate: string,
  startIndex: number,
  apiKey: string | undefined
): Promise<NvdApiResponse> {
  const url = new URL(NVD_API_BASE_URL);
  url.searchParams.set("pubStartDate", pubStartDate);
  url.searchParams.set("pubEndDate", pubEndDate);
  url.searchParams.set("resultsPerPage", String(RESULTS_PER_PAGE));
  url.searchParams.set("startIndex", String(startIndex));

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "SecureLogic-AI/1.0 (NVD Adapter)"
  };

  if (apiKey) {
    headers["apiKey"] = apiKey;
  }

  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    throw new Error(`NVD fetch failed: HTTP ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as NvdApiResponse;

  if (!Array.isArray(body.vulnerabilities)) {
    throw new Error("NVD response malformed: vulnerabilities array missing");
  }

  return body;
}

// ---------------------------------------------------------------------------
// fetchNvdSignals (I/O — exported)
// ---------------------------------------------------------------------------

/**
 * Fetch CVEs published within the last `windowDays` days from the NVD API.
 *
 * Handles pagination: each page waits INTER_PAGE_DELAY_MS (600ms) before
 * the next request. For typical 7-day windows, one page suffices.
 *
 * Optionally reads NVD_API_KEY from the environment — raises rate limit
 * from 5 req/30s to 50 req/30s.
 *
 * @param windowDays  Number of days to look back (1–30). Default 7.
 * @returns           { signals, total, pages, skipped }
 *                    total = raw entry count from NVD (before mapping)
 *                    pages = number of HTTP requests made
 *                    skipped = entries dropped due to invalid CVE IDs
 */
export async function fetchNvdSignals(windowDays = 7): Promise<{
  signals: CyberSignalIngestInput[];
  total: number;
  pages: number;
  skipped: number;
}> {
  const apiKey = process.env["NVD_API_KEY"];

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const pubStartDate = formatNvdDate(startDate);
  const pubEndDate = formatNvdDate(endDate);

  const signals: CyberSignalIngestInput[] = [];
  let skipped = 0;
  let pages = 0;
  let startIndex = 0;
  let totalResults = 0;

  do {
    if (pages > 0) {
      // Respect NVD rate limit between paginated requests.
      await sleep(INTER_PAGE_DELAY_MS);
    }

    const page = await fetchNvdPage(pubStartDate, pubEndDate, startIndex, apiKey);
    pages++;
    totalResults = page.totalResults;

    for (const vuln of page.vulnerabilities) {
      const mapped = mapNvdCveToSignal(vuln);
      if (mapped === null) {
        skipped++;
        continue;
      }
      signals.push(mapped);
    }

    startIndex += page.resultsPerPage;
  } while (startIndex < totalResults);

  return { signals, total: totalResults, pages, skipped };
}
