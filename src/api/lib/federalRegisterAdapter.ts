/**
 * federalRegisterAdapter.ts — Federal Register (US federal rulemaking) adapter.
 *
 * The regulatory half of the promise. Fetches recently-published final and
 * proposed RULES from the Federal Register public API, filtered to the
 * cyber/privacy regulatory space, and maps each to a CyberSignalIngestInput as a
 * regulatory_change signal. Signals carry NO vendor/CVE — they flow through the
 * matcher's OBLIGATION branch (scoreObligationMatch on the regulation-family
 * vocabulary), so a rule that cites a known family (HIPAA, GDPR, PCI DSS, …)
 * becomes a suggest-only obligation match for orgs that track it. Mirrors
 * secEdgarAdapter.ts / nvdAdapter.ts.
 *
 * API
 * ---
 * GET https://www.federalregister.gov/api/v1/documents.json  (keyless JSON)
 *   conditions[term]                  — full-text relevance term (one per query)
 *   conditions[type][]                — RULE | PRORULE (final + proposed rules)
 *   conditions[publication_date][gte] — YYYY-MM-DD (window start)
 *   conditions[publication_date][lte] — YYYY-MM-DD (window end)
 *   per_page (max 1000), page, order=newest, fields[] — projection
 *
 * The term filter is broad (full-text), so this intentionally over-fetches the
 * relevance space; the obligation matcher's family vocabulary is what gates a
 * real match. Unmatched rules are stored as regulatory context, producing no
 * suggestions (no false matches). Multiple terms are queried and de-duplicated
 * by document_number.
 *
 * No API key; a declared User-Agent is courteous. Volume is small (a 7-day
 * window of cyber/privacy rules is tens of documents), well within limits.
 *
 * MAPPING
 *   source             "federal_register"
 *   signal_type        "regulatory_change"
 *   severity           RULE → "Moderate", PRORULE → "Low" (regulatory context,
 *                      not incident severity; does not drive finding/action gen)
 *   affected_vendor    null   affected_cve null
 *   external_id        the document number (e.g. "2026-12399") — stable dedup key
 *   normalized_summary title + abstract (truncated)
 *
 * All functions except fetchFederalRegisterSignals() are pure.
 */

import type { CyberSignalIngestInput } from "./cyberSignalValidation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FrAgency = { raw_name?: string; name?: string };

export type FrDocument = {
  document_number?: string;
  title?: string;
  type?: string; // "Rule" | "Proposed Rule" | ...
  abstract?: string | null;
  publication_date?: string;
  html_url?: string;
  agencies?: FrAgency[];
};

export type FrSearchResponse = {
  count: number;
  total_pages?: number;
  results?: FrDocument[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FR_API_BASE_URL = "https://www.federalregister.gov/api/v1/documents.json";

const FR_USER_AGENT = "SecureLogic-AI research info@securelogicai.com";

/** Relevance terms queried separately and de-duplicated by document_number. */
export const FR_RELEVANCE_TERMS = ["cybersecurity", "data breach", "privacy"];

/** Only final + proposed rules (the regulatory CHANGES), not routine notices. */
const FR_DOC_TYPES = ["RULE", "PRORULE"];

const RESULTS_PER_PAGE = 100;
const INTER_REQUEST_DELAY_MS = 300;
const MAX_PAGES_PER_TERM = 10;
const MAX_SUMMARY_LEN = 500;

// ---------------------------------------------------------------------------
// frSeverity (pure — exported for testing)
// ---------------------------------------------------------------------------

/** Final rules (in effect) outrank proposed rules. Regulatory context, not incident severity. */
export function frSeverity(type: string | undefined): "Moderate" | "Low" {
  return type === "Rule" ? "Moderate" : "Low";
}

// ---------------------------------------------------------------------------
// buildFrSummary (pure — exported for testing)
// ---------------------------------------------------------------------------

export function buildFrSummary(doc: FrDocument): string {
  const title = (doc.title ?? "").trim();
  const abstract = (doc.abstract ?? "").trim();
  const combined = abstract ? `${title} — ${abstract}` : title;
  return combined.length > MAX_SUMMARY_LEN
    ? `${combined.slice(0, MAX_SUMMARY_LEN - 3)}...`
    : combined;
}

// ---------------------------------------------------------------------------
// mapFrDocumentToSignal (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Map a Federal Register document to a CyberSignalIngestInput. Returns null if
 * the document lacks a document_number (the dedup key) or a title.
 */
export function mapFrDocumentToSignal(doc: FrDocument): CyberSignalIngestInput | null {
  const documentNumber = doc.document_number?.trim();
  if (!documentNumber) return null;
  const title = doc.title?.trim();
  if (!title) return null;

  const agencyNames = Array.isArray(doc.agencies)
    ? doc.agencies.map((a) => a.name ?? a.raw_name).filter((n): n is string => !!n)
    : [];

  return {
    source: "federal_register",
    signal_type: "regulatory_change",
    severity: frSeverity(doc.type),
    raw_payload: {
      document_number: documentNumber,
      type: doc.type ?? null,
      title,
      abstract: doc.abstract ?? null,
      agencies: agencyNames,
      publication_date: doc.publication_date ?? null,
      html_url: doc.html_url ?? null
    },
    normalized_summary: buildFrSummary(doc),
    affected_vendor: null,
    affected_cve: null,
    external_id: documentNumber
  };
}

// ---------------------------------------------------------------------------
// formatFrDate (pure, local)
// ---------------------------------------------------------------------------

function formatFrDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// fetchFrPage (I/O, local)
// ---------------------------------------------------------------------------

async function fetchFrPage(
  term: string,
  gte: string,
  lte: string,
  page: number
): Promise<FrSearchResponse> {
  const url = new URL(FR_API_BASE_URL);
  url.searchParams.set("conditions[term]", term);
  url.searchParams.set("conditions[publication_date][gte]", gte);
  url.searchParams.set("conditions[publication_date][lte]", lte);
  for (const t of FR_DOC_TYPES) {
    url.searchParams.append("conditions[type][]", t);
  }
  for (const f of [
    "document_number", "title", "type", "abstract",
    "publication_date", "html_url", "agencies"
  ]) {
    url.searchParams.append("fields[]", f);
  }
  url.searchParams.set("per_page", String(RESULTS_PER_PAGE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("order", "newest");

  const response = await fetch(url.toString(), {
    headers: { "Accept": "application/json", "User-Agent": FR_USER_AGENT }
  });

  if (!response.ok) {
    throw new Error(
      `Federal Register fetch failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const body = (await response.json()) as FrSearchResponse;
  if (typeof body.count !== "number") {
    throw new Error("Federal Register response malformed: count missing");
  }
  return body;
}

// ---------------------------------------------------------------------------
// fetchFederalRegisterSignals (I/O — exported)
// ---------------------------------------------------------------------------

/**
 * Fetch cyber/privacy final + proposed rules published in the last `windowDays`
 * days. Queries each relevance term, paginates, and de-duplicates by
 * document_number across terms.
 *
 * @returns { signals, total, pages, skipped }
 *          total = unique documents seen (before mapping)
 *          pages = HTTP requests made
 *          skipped = documents dropped (no document_number/title)
 */
export async function fetchFederalRegisterSignals(windowDays = 7): Promise<{
  signals: CyberSignalIngestInput[];
  total: number;
  pages: number;
  skipped: number;
}> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const gte = formatFrDate(startDate);
  const lte = formatFrDate(endDate);

  const seen = new Set<string>();
  const signals: CyberSignalIngestInput[] = [];
  let pages = 0;
  let skipped = 0;

  for (const term of FR_RELEVANCE_TERMS) {
    let page = 1;
    let totalPages = 1;
    do {
      if (pages > 0) await sleep(INTER_REQUEST_DELAY_MS);
      const body = await fetchFrPage(term, gte, lte, page);
      pages++;
      totalPages = Math.min(body.total_pages ?? 1, MAX_PAGES_PER_TERM);

      for (const doc of body.results ?? []) {
        const dn = doc.document_number?.trim();
        if (!dn || seen.has(dn)) continue; // de-dup across terms
        seen.add(dn);
        const mapped = mapFrDocumentToSignal(doc);
        if (mapped === null) {
          skipped++;
          continue;
        }
        signals.push(mapped);
      }
      page++;
    } while (page <= totalPages);
  }

  return { signals, total: seen.size, pages, skipped };
}
