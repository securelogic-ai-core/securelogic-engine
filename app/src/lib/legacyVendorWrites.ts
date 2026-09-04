/**
 * legacyVendorWrites.ts — app-side mirror of the engine's B1 demotion flag
 * (src/api/lib/legacyVendorWriteFlag.ts). Same env var name on both services
 * (two-switch model, per the risk_intelligence precedent), so the UI never
 * offers a write the engine will refuse with 410.
 *
 * Flag ON (the default — only the literal "false" disables): the legacy
 * assess/review flows render as they always have. Flag OFF: every legacy
 * write CTA is replaced by the canonical engagement workflow entry point, the
 * legacy form pages render a retirement notice instead of their forms, and the
 * server actions refuse before calling the engine.
 *
 * Server-side only (page Server Components + server actions) — the env var is
 * not NEXT_PUBLIC and client components must receive the resolved value as a
 * prop if they ever need it.
 */
export function legacyVendorWritesEnabled(): boolean {
  return process.env.SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED !== "false";
}

/** The canonical replacement CTA for every demoted legacy write surface. */
export function engagementCta(vendorId?: string): { href: string; label: string } {
  return {
    // Vendor Onboarding 2.0: the canonical way in is the vendor page — record
    // the relationship's factual intake, get the derived classification, and
    // open the assessment at the derived tier. /vendor-engagements/new
    // re-asks the intake and is the pre-2.0 path.
    href: vendorId
      ? `/vendors/${encodeURIComponent(vendorId)}#relationships`
      : "/vendors",
    label: "Classify and assess from the vendor page",
  };
}

/** One sentence, used verbatim wherever a legacy form is retired. */
export const LEGACY_WRITE_RETIRED_COPY =
  "Point-in-time assessments and review cycles have been retired in favor of vendor engagements — structured intake, a vendor-completed questionnaire, reviewed evidence, residual risk, and continuous monitoring in one workflow.";
