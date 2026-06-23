/**
 * secEdgarAdapter.ts — SEC EDGAR 8-K Item 1.05 (Material Cybersecurity Incidents) adapter.
 *
 * Phase-1 vendor-breach source. Fetches recent 8-K filings disclosing a material
 * cybersecurity incident (Item 1.05) from the EDGAR full-text search (EFTS) API
 * and maps each to the platform's CyberSignalIngestInput as a third_party_breach
 * signal, keyed on the filer company name (→ affected_vendor) so the existing
 * vendor matcher links it to a customer's vendors. Mirrors nvdAdapter.ts.
 *
 * EFTS API
 * --------
 * Endpoint: https://efts.sec.gov/LATEST/search-index   (keyless JSON)
 *
 * Query parameters used:
 *   q       — "Material Cybersecurity Incidents" (the Item 1.05 heading; a strong
 *             prefilter, NOT authoritative on its own)
 *   forms   — 8-K
 *   startdt — YYYY-MM-DD (UTC)
 *   enddt   — YYYY-MM-DD (UTC)
 *   from    — 0-based pagination offset
 *   size    — page size (EFTS max 100; the actual returned batch size drives
 *             pagination so we are robust whether or not size is honoured)
 *
 * THE FILTER IS TWO-PART. The q phrase narrows the result set; the AUTHORITATIVE
 * test is that _source.items includes "1.05". A hit matching the phrase but
 * lacking item 1.05 is dropped. (The items array is confirmed present in the
 * native EFTS response.)
 *
 * USER-AGENT (REQUIRED)
 * ---------------------
 * SEC requires a declared User-Agent of the form "CompanyName contact@email";
 * a missing/invalid UA returns 403. No API key exists for EFTS. Rate limit is
 * 10 req/s per IP — a daily cron over a 7-day window is orders of magnitude
 * under it (Item 1.05 filings number in the low tens per YEAR).
 *
 * MAPPING
 * -------
 *   source             "sec_edgar"
 *   signal_type        "third_party_breach"
 *   severity           "High" (flat — Item 1.05 only fires on a materiality
 *                      determination; EFTS metadata gives nothing to grade on)
 *   affected_vendor    filer company name, parsed from display_names[0] by
 *                      stripping the "  (TICKER)  (CIK …)" suffix. NOT further
 *                      canonicalized here — the matcher's canonicalizeVendorName
 *                      handles suffix/case normalization at match time.
 *   affected_cve       null
 *   external_id        the accession number (adsh) — REQUIRED dedup discriminator
 *                      so two 8-Ks from the SAME filer produce distinct rows.
 *   normalized_summary metadata-only (EFTS carries no incident narrative)
 *
 * PURE vs I/O BOUNDARY
 * --------------------
 * All functions except fetchSecEdgarSignals() are pure and fully unit-testable.
 * fetchSecEdgarSignals() performs HTTP requests and applies inter-page delays.
 */

import type { CyberSignalIngestInput } from "./cyberSignalValidation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EdgarHitSource = {
  ciks?: string[];
  display_names?: string[];
  file_date?: string;
  form?: string;
  adsh?: string;
  items?: string[];
  [key: string]: unknown;
};

export type EdgarHit = {
  /** "<accession>:<primary-doc>", e.g. "0001654954-25-010613:daio_8k.htm" */
  _id?: string;
  _source?: EdgarHitSource;
};

export type EdgarSearchResponse = {
  hits: {
    total: { value: number };
    hits: EdgarHit[];
  };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EFTS_API_BASE_URL = "https://efts.sec.gov/LATEST/search-index";

/** SEC-required User-Agent: "CompanyName contact@email". Not a secret. */
const EDGAR_USER_AGENT = "SecureLogic-AI research info@securelogicai.com";

/** Item 1.05 heading — strong q prefilter (not authoritative; see items check). */
const CYBER_INCIDENT_QUERY = '"Material Cybersecurity Incidents"';

/** Authoritative marker: the 8-K item code for Material Cybersecurity Incidents. */
export const CYBER_INCIDENT_ITEM = "1.05";

/** Requested page size (EFTS max 100). Actual batch size drives pagination. */
const RESULTS_PER_PAGE = 100;

/** Delay between paginated requests — well under SEC's 10 req/s. */
const INTER_PAGE_DELAY_MS = 300;

/** Hard pagination backstop (Item 1.05 volume is tiny; one page is the norm). */
const MAX_PAGES = 50;

// ---------------------------------------------------------------------------
// parseEdgarCompanyName (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse the filer company name from an EFTS display_names entry, stripping the
 * trailing "  (TICKER)  (CIK …)" annotation.
 *
 * @example
 *   parseEdgarCompanyName("DATA I/O CORP  (DAIO)  (CIK 0000351998)") // "DATA I/O CORP"
 *   parseEdgarCompanyName("Sensata Technologies Holding plc  (ST)  (CIK 0001477294)")
 *     // "Sensata Technologies Holding plc"
 */
export function parseEdgarCompanyName(displayName: string): string {
  if (typeof displayName !== "string") return "";
  // Cut at the first " (" group (ticker/CIK annotation). Names themselves do
  // not contain a space-then-paren in EDGAR's display form.
  const cut = displayName.split(/\s+\(/)[0] ?? "";
  return cut.trim();
}

// ---------------------------------------------------------------------------
// buildEdgarFilingUrl (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Construct the SEC Archives URL for a filing's primary document.
 *
 *   https://www.sec.gov/Archives/edgar/data/<cik-no-leading-zeros>/<accession-no-dashes>/<primary-doc>
 *
 * Returns null if cik or accession is missing.
 */
export function buildEdgarFilingUrl(
  cik: string | null | undefined,
  accession: string | null | undefined,
  primaryDoc: string
): string | null {
  if (!cik || !accession) return null;
  const cikNum = String(parseInt(cik, 10)); // strip leading zeros
  if (cikNum === "NaN") return null;
  const adshNoDashes = accession.replace(/-/g, "");
  const doc = primaryDoc.trim();
  const base = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${adshNoDashes}`;
  return doc.length > 0 ? `${base}/${doc}` : base;
}

// ---------------------------------------------------------------------------
// hitHasCyberIncidentItem (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Authoritative Item 1.05 test: the hit's items array must include "1.05".
 * The q phrase is only a prefilter; this is what makes it a cyber-incident 8-K.
 */
export function hitHasCyberIncidentItem(hit: EdgarHit): boolean {
  const items = hit?._source?.items;
  return Array.isArray(items) && items.includes(CYBER_INCIDENT_ITEM);
}

// ---------------------------------------------------------------------------
// primaryDocFromId (pure, local)
// ---------------------------------------------------------------------------

/** Extract the primary document name from an EFTS _id ("<adsh>:<doc>"). */
function primaryDocFromId(id: string | undefined): string {
  if (typeof id !== "string" || !id.includes(":")) return "";
  return id.slice(id.indexOf(":") + 1).trim();
}

// ---------------------------------------------------------------------------
// mapEdgarHitToSignal (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Map a single EFTS hit to a CyberSignalIngestInput. Returns null for hits that
 * cannot be mapped cleanly or are not Item 1.05:
 *   - no _source / no accession / no display name
 *   - items does not include "1.05" (q-phrase false positive)
 *
 * The caller skips null results and continues with the rest of the batch.
 */
export function mapEdgarHitToSignal(hit: EdgarHit): CyberSignalIngestInput | null {
  const src = hit?._source;
  if (!src) return null;

  const accession = src.adsh?.trim();
  if (!accession) return null;

  // Authoritative Item 1.05 filter — drop q-phrase false positives.
  if (!hitHasCyberIncidentItem(hit)) return null;

  const displayName =
    Array.isArray(src.display_names) && src.display_names.length > 0
      ? src.display_names[0]!
      : "";
  const company = parseEdgarCompanyName(displayName);
  if (!company) return null;

  const cik = Array.isArray(src.ciks) && src.ciks.length > 0 ? src.ciks[0]! : null;
  const filingUrl = buildEdgarFilingUrl(cik, accession, primaryDocFromId(hit._id));
  const fileDate = typeof src.file_date === "string" ? src.file_date : "";

  const normalizedSummary =
    `${company} disclosed a material cybersecurity incident (8-K Item 1.05)` +
    (fileDate ? `, filed ${fileDate}` : "") +
    ".";

  return {
    source: "sec_edgar",
    signal_type: "third_party_breach",
    severity: "High",
    raw_payload: {
      accession,
      cik,
      company,
      display_name: displayName,
      form: src.form ?? null,
      items: Array.isArray(src.items) ? src.items : [],
      file_date: fileDate,
      filing_url: filingUrl
    },
    normalized_summary: normalizedSummary,
    affected_vendor: company,
    affected_cve: null,
    external_id: accession
  };
}

// ---------------------------------------------------------------------------
// formatEdgarDate (pure, local)
// ---------------------------------------------------------------------------

/** Format a Date as EFTS's required YYYY-MM-DD (UTC). */
function formatEdgarDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// sleep (local)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// fetchEdgarPage (I/O, local)
// ---------------------------------------------------------------------------

async function fetchEdgarPage(
  startdt: string,
  enddt: string,
  from: number
): Promise<EdgarSearchResponse> {
  const url = new URL(EFTS_API_BASE_URL);
  url.searchParams.set("q", CYBER_INCIDENT_QUERY);
  url.searchParams.set("forms", "8-K");
  url.searchParams.set("startdt", startdt);
  url.searchParams.set("enddt", enddt);
  url.searchParams.set("from", String(from));
  url.searchParams.set("size", String(RESULTS_PER_PAGE));

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "User-Agent": EDGAR_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(
      `SEC EDGAR fetch failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const body = (await response.json()) as EdgarSearchResponse;

  if (!body.hits || !Array.isArray(body.hits.hits)) {
    throw new Error("SEC EDGAR response malformed: hits.hits array missing");
  }

  return body;
}

// ---------------------------------------------------------------------------
// fetchSecEdgarSignals (I/O — exported)
// ---------------------------------------------------------------------------

/**
 * Fetch 8-K Item 1.05 filings from the last `windowDays` days from EFTS.
 *
 * Paginates on `from` by the actual returned batch size (robust to EFTS's page
 * size), waiting INTER_PAGE_DELAY_MS between requests. Item 1.05 volume is tiny,
 * so one page is the norm.
 *
 * @param windowDays  Number of days to look back (1–30). Default 7.
 * @returns           { signals, total, pages, skipped }
 *                    total   = raw EFTS hit count (before item-1.05 filtering)
 *                    pages   = number of HTTP requests made
 *                    skipped = hits dropped (not item 1.05, or unmappable)
 */
export async function fetchSecEdgarSignals(windowDays = 7): Promise<{
  signals: CyberSignalIngestInput[];
  total: number;
  pages: number;
  skipped: number;
}> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const startdt = formatEdgarDate(startDate);
  const enddt = formatEdgarDate(endDate);

  const signals: CyberSignalIngestInput[] = [];
  let skipped = 0;
  let pages = 0;
  let from = 0;
  let totalResults = 0;

  do {
    if (pages > 0) {
      await sleep(INTER_PAGE_DELAY_MS);
    }

    const page = await fetchEdgarPage(startdt, enddt, from);
    pages++;
    totalResults = page.hits.total.value;

    const batch = page.hits.hits;
    for (const hit of batch) {
      const mapped = mapEdgarHitToSignal(hit);
      if (mapped === null) {
        skipped++;
        continue;
      }
      signals.push(mapped);
    }

    if (batch.length === 0) break; // safety: no progress
    from += batch.length;
  } while (from < totalResults && pages < MAX_PAGES);

  return { signals, total: totalResults, pages, skipped };
}
