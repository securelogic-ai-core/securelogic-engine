/**
 * signalProductEvidence.ts — extract PRODUCT evidence from an ingested signal.
 *
 * C4 / ADR-0003 D1. PURE: no I/O, no schema.
 *
 * WHY THIS EXISTS
 *   ERG R2: `affected` requires authoritative evidence identifying the affected
 *   technology/product — and "vendor identity ALONE is never product-identifiable".
 *   But the live pipeline only ever persisted `cyber_signals.affected_vendor`. The
 *   product name was DISCARDED at ingest: cisaKevAdapter reads `entry.product`, uses
 *   it to build the summary string, and then stores only `vendorProject`.
 *
 *   The product was never actually lost — `raw_payload` holds the whole feed entry.
 *   It was simply never read. This module reads it.
 *
 *   That gap is why the shadow runner had to feed the VENDOR name in as the product
 *   (`vendor: productHint, product: productHint`) just to produce candidates — a
 *   measurement hack its own header admits to. C4 removes the need for it.
 *
 * WHAT IT IS NOT
 *   Not a matcher, not a normalizer. It reports what the FEED said, in the feed's own
 *   words. Canonicalization is `canonicalizeVendorName`'s job (one normalizer, EAR-AD-3);
 *   deciding applicability is `ApplicabilityEngineV1`'s.
 */

/** The product-bearing shape of a signal, as far as this module cares. */
export interface SignalProductInput {
  source: string;
  affected_vendor: string | null;
  affected_cve: string | null;
  raw_payload: Record<string, unknown> | null;
}

export interface SignalProductEvidence {
  /** The product name as the FEED stated it (raw, un-canonicalized). */
  product_raw: string;
  /** The vendor the feed attributed it to, if any. */
  vendor_raw: string | null;
  /** Which feed field this came from — the explainability trail ERG R2 requires. */
  evidence_ref: string;
}

/** Read a trimmed, non-empty string from an unknown payload field. */
function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Per-source product field. Explicit and per-feed BY DESIGN — guessing a product from
 * an arbitrary payload is exactly the kind of inference R2 forbids. A source we have
 * not taught yields NO product evidence, and therefore cannot raise `affected`. That
 * is the honest failure mode: silence, not a guess.
 */
const PRODUCT_FIELD_BY_SOURCE: Record<string, string> = {
  // CISA KEV: {cveID, vendorProject, product, vulnerabilityName, …}
  cisa_kev: "product",
  "cisa-kev": "product",
};

/**
 * Extract the product the signal is about. Returns null when the feed named no
 * product — which is a truthful "we cannot identify the product", NOT a licence to
 * fall back to the vendor name.
 */
export function extractSignalProductEvidence(
  signal: SignalProductInput
): SignalProductEvidence | null {
  const payload = signal.raw_payload;
  if (!payload || typeof payload !== "object") return null;

  const field = PRODUCT_FIELD_BY_SOURCE[signal.source];
  if (!field) return null;

  const product_raw = str(payload, field);
  if (!product_raw) return null;

  return {
    product_raw,
    vendor_raw: signal.affected_vendor,
    evidence_ref: `${signal.source}:${field}`,
  };
}
