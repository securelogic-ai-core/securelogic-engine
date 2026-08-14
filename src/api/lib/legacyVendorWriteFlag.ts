/**
 * legacyVendorWriteFlag.ts — the B1 demotion switch for the legacy Vendor
 * Assurance write paths.
 *
 * Phase 7 of the September 15 program (Launch Completion item 1) makes
 * `vendor_engagements` the single canonical vendor-assurance workflow writer.
 * The legacy write surfaces this flag demotes:
 *
 *     POST  /api/vendor-assessments        (inserts a vendor_assessments row)
 *     POST  /api/vendor-reviews            (inserts a vendor_reviews row)
 *     PATCH /api/vendor-reviews/:id        (updates a vendor_reviews row)
 *
 * With the flag OFF those routes refuse with 410 Gone and point the caller at
 * the engagement API. Their READ siblings (GET list/detail) are untouched —
 * per the spine migration's own contract (20260919_vendor_engagements.sql:
 * "their rows and their findings stay valid and visible, only their write
 * paths retire").
 *
 * Writers this flag deliberately does NOT govern:
 *   - the GDPR account-deletion reaper's reviewer_id scrub
 *     (accountDeletionReaper.ts) — an erasure obligation, not a workflow
 *     writer; it must keep working after the freeze (ADR-0005 precedent);
 *   - operator seed scripts and isolation-test fixtures, which write via
 *     direct SQL as data fixtures, not through the product workflow;
 *   - POST /api/assess (`assessments`) — the generic assessment runner, a
 *     public API compatibility path outside the vendor workflow (Gate 0
 *     evidence §4; retiring it is a separate decision with a notice period).
 *
 * DEFAULT ON. Like SECURELOGIC_ASK_ENABLED, only the literal "false"
 * disables: these are live production surfaces with first-party UI callers,
 * so the demotion must ship dark (GATE B) — prod behavior changes only when
 * the operator flips the env var. Staging runs "false" to validate the
 * demoted state ahead of the prod flip.
 *
 * The app reads the SAME env var name server-side to swap the vendor page's
 * legacy CTAs for the engagement workflow entry point, so the UI never offers
 * a write the engine will refuse.
 */
export function legacyVendorWritesEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED"] !== "false";
}

/** The 410 body every demoted route returns — one shape, asserted by tests. */
export const LEGACY_VENDOR_WRITE_GONE = {
  error: "legacy_vendor_workflow_retired",
  message:
    "This legacy vendor-assurance write path has been retired. Open a vendor engagement instead.",
  replacement: "/api/vendor-engagements",
} as const;
