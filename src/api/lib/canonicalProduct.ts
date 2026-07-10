/**
 * canonicalProduct.ts — Canonical Product identity normalization (Enterprise Risk
 * Graph convergence, Phase C1). PURE and DARK: no I/O, no schema, no callers yet.
 *
 * WHY (ruling R1, `docs/architecture/proposals/ENTERPRISE-RISK-GRAPH.md`): a Canonical
 * Product is an INTERMEDIATE reference entity used to normalize external
 * product/version/package/service identities BEFORE they are resolved to tenant
 * assets. It is NOT the primary customer-risk object — impact attaches to canonical
 * tenant assets, never to products or vendors.
 *
 * WHY (ruling R2): vendor identity ALONE is not a product identity and must never
 * yield an `affected` determination. This module encodes that invariant in
 * `identifiable`: a normalized identity is product-identifiable ONLY when it carries
 * a product token or a CVE (an external identifier that resolves to a product/version
 * via authoritative data) — never from a vendor name alone.
 *
 * The normalizer REUSES the single canonical vendor/name normalizer
 * (`canonicalizeVendorName`) — one normalization model, per the convergence mandate;
 * it does not introduce a second.
 */

import { canonicalizeVendorName } from "./vendorNameCanonical.js";

export interface ProductIdentityInput {
  /** Free-text vendor/publisher name from the signal (e.g. "Microsoft Corporation"). */
  vendor?: string | null;
  /** Free-text product name when the source provides one (e.g. "Exchange Server"). */
  product?: string | null;
  /** A CVE identifier when present (any case; validated + uppercased). */
  cve?: string | null;
}

export interface CanonicalProductIdentity {
  /** Canonical vendor token (normalize-then-exact), or null. */
  vendor_canonical: string | null;
  /** Canonical product token (normalize-then-exact), or null. */
  product_canonical: string | null;
  /** Normalized CVE `CVE-YYYY-NNNN…` (uppercased) or null when absent/invalid. */
  cve: string | null;
  /**
   * Stable lookup/dedup key for the intermediate Canonical Product reference.
   * Deterministic join of the normalized parts; `""` segments are preserved so the
   * key shape is stable. Never used as a tenant key (products are org-neutral).
   */
  canonical_key: string;
  /**
   * R2 invariant: true ONLY when a product token or a CVE is present. Vendor name
   * alone is NOT product-identifiable — downstream applicability must not treat a
   * vendor-only match as evidence of an affected product/asset.
   */
  identifiable: boolean;
}

const CVE_RE = /^CVE-\d{4}-\d{4,}$/;

/** Normalize a CVE string to canonical uppercase form, or null if absent/invalid. */
export function normalizeCve(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const up = raw.trim().toUpperCase();
  return CVE_RE.test(up) ? up : null;
}

/** Normalize a name token via the single canonical normalizer; "" → null. */
function normToken(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const c = canonicalizeVendorName(raw);
  return c === "" ? null : c;
}

/**
 * Derive the canonical, org-neutral product identity from a signal's affected
 * fields. Pure and deterministic. Encodes R1 (intermediate reference) and R2
 * (vendor-alone is not product-identifiable) — nothing here resolves to a tenant
 * asset; that is the separate, tenant-scoped resolution stage (Phase C2).
 */
export function canonicalProductIdentity(input: ProductIdentityInput): CanonicalProductIdentity {
  const vendor_canonical = normToken(input.vendor);
  const product_canonical = normToken(input.product);
  const cve = normalizeCve(input.cve);
  const identifiable = Boolean(product_canonical || cve);
  const canonical_key = [vendor_canonical ?? "", product_canonical ?? "", cve ?? ""].join("|");
  return { vendor_canonical, product_canonical, cve, canonical_key, identifiable };
}
