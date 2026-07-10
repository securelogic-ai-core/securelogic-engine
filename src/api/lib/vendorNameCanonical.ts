/**
 * vendorNameCanonical.ts — the SINGLE canonical vendor/name normalizer.
 *
 * Extracted verbatim from cyberSignalProcessingService.ts (Enterprise Risk Graph
 * convergence, Phase C1) so it can be imported by pure, dark modules
 * (e.g. `canonicalProduct.ts`) WITHOUT pulling in the service's database-pool
 * import side effect. cyberSignalProcessingService.ts re-exports
 * `canonicalizeVendorName` from here, so every existing importer is unchanged —
 * there remains exactly ONE normalizer, no duplication (the convergence mandate).
 */

/**
 * Trailing legal/entity suffixes stripped during canonicalization. Stripped
 * ONLY when they are the last remaining token(s) — a suffix word that appears
 * mid-name is kept (e.g. "Corp of America" → "corp of america"). The point is
 * to collapse the dominant cross-feed gap: the same brand arrives as a bare
 * name (KEV "Microsoft"), a CPE slug (NVD "microsoft"), and a formal legal name
 * (EDGAR "MICROSOFT CORP"). All must canonicalize identically.
 */
export const VENDOR_LEGAL_SUFFIXES = new Set<string>([
  "corp", "corporation", "inc", "incorporated", "llc", "ltd", "limited",
  "plc", "co", "company", "gmbh", "sa", "ag", "nv", "holding", "holdings"
]);

/**
 * Canonicalize a vendor name for EXACT comparison. The SAME function is applied
 * to both the signal's affected_vendor and each candidate vendors.name — using
 * one helper for both sides is the whole point: asymmetric normalization would
 * silently drop true matches.
 *
 * Transform (deterministic, order matters):
 *   1. lowercase
 *   2. every run of non-[a-z0-9] becomes a single space (punctuation → space)
 *   3. trim + collapse whitespace
 *   4. strip TRAILING legal suffix tokens, repeatedly (e.g. "foo holdings inc"
 *      → "foo"), but never the last remaining token (so a vendor literally
 *      named "Co" or "Holdings" survives).
 *
 * This is normalization-then-EXACT: the result is compared with === . There is
 * no wildcard/substring/fuzzy step, so a 2-char canonical ("hp") matches only a
 * vendor whose canonical is exactly "hp" — short names cannot leak. Fuzzy /
 * suggest-only recall is a deferred Phase 2 and deliberately not done here.
 */
export function canonicalizeVendorName(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (base === "") return "";

  const tokens = base.split(" ");
  while (tokens.length > 1 && VENDOR_LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(" ");
}
