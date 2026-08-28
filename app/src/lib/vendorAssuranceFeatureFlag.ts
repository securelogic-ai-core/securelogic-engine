/**
 * vendorAssuranceFeatureFlag.ts — app half of the Vendor Assurance activation
 * switch (VA-NAV-1).
 *
 * The engine's SECURELOGIC_VENDOR_ASSURANCE_ENABLED 404s every
 * /api/vendor-assurance and /api/vendor-engagements route independently (see
 * src/api/lib/vendorAssuranceFeatureFlag.ts). Until this file existed the app
 * had NO read of that key: the "Vendor Assurance" group was declared in BOTH
 * nav models with `platform: true` and no `featureFlag`, so a platform-tier
 * user in production — where the engine flag is false — saw three nav entries
 * whose every destination degraded to an empty/unavailable page. This reads
 * the SAME key on the app tier so the nav group, the six pages under
 * /vendor-assurance and /vendor-engagements go dark with the engine. Two
 * switches, one key: neither tier can be reached by way of the other.
 *
 * Resolution is IDENTICAL to the engine resolver, so the two tiers cannot
 * disagree in any environment:
 *   - "true"                                  → on
 *   - anything else (unset, "", "1", "TRUE")  → OFF when NODE_ENV=production
 *   - anything else, NODE_ENV !== production  → on (dev/test default — the
 *     ruled engine posture; `next start` and every Render service run with
 *     NODE_ENV=production, so a missing key is OFF everywhere that ships)
 *
 * This is deliberately NOT the strict `=== "true"` of penTestEnabled /
 * riskAcceptanceEnabled: those mirror engine resolvers that are strict; this
 * one mirrors an engine resolver that fails open off-production, and an
 * app-strict / engine-open pair would make local dev render a dead menu.
 *
 * NOT gated here (ruled, VA-6): vendor curation on the frameworks spine —
 * /vendors, /vendors/[id], /vendors/[id]/assess. Those are the vendor
 * register, not the assurance engagement workflow.
 *
 * Read at call time (plain server-side env, not NEXT_PUBLIC, not baked into a
 * client bundle), so a Render restart applies it without a rebuild.
 */
export function vendorAssuranceEnabled(
  // Plain record rather than NodeJS.ProcessEnv: the app's ProcessEnv requires
  // NODE_ENV, which would force every test case to supply unrelated keys.
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] === "true") return true;
  if (env["NODE_ENV"] !== "production") return true;
  return false;
}
