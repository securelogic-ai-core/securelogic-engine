/**
 * suggestionSurfacedTelemetry.ts — records that a control-match suggestion was
 * actually returned to a user-facing product surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * Candidate C — narrowing which signals receive tenant-specific LLM control
 * matching — is DEFERRED for want of production customer-value evidence. The
 * blocking gap is not acceptance data; it is that a low acceptance rate and
 * "nobody ever saw it" are indistinguishable today. Both look like a suggestion
 * row with a NULL accepted_at. Those are opposite conclusions, and one of them
 * would wrongly justify cutting the feature.
 *
 * WHAT "SURFACED" MEANS HERE — AND WHAT IT DOES NOT
 * -------------------------------------------------
 * Surfaced = **this suggestion id was included in the body of a successful
 * response from the authenticated user-facing suggestions list endpoint**
 * (`GET /api/signal-match-suggestions`).
 *
 * It explicitly does NOT mean:
 *   - the suggestion was generated, or written to the database;
 *   - the endpoint was called (a call returning other rows surfaces nothing);
 *   - a page was loaded (only rows actually in the payload count);
 *   - the row became eligible for display;
 *   - a background worker touched it.
 *
 * The honest boundary: this proves the application DELIVERED the suggestion to
 * the product surface. It does NOT prove a human read it — the server cannot
 * know that, and no proxy for it is invented here. `/signal-match-suggestions/counts`
 * and the enterprise-context stats rollup return aggregates only and are
 * therefore NOT surfacing paths; neither records anything.
 *
 * DEDUPLICATION
 * -------------
 * A list view can legitimately be re-rendered many times a minute. Writing one
 * row per render would produce telemetry inflation that answers no question we
 * have. So:
 *   - `first_surfaced_at` is set ONCE, on the first ever surfacing. This is the
 *     column that answers "was it actually shown?" and it is never overwritten.
 *   - A repeat within SURFACE_COALESCE_WINDOW_MS updates NOTHING.
 *   - A surfacing after that window is treated as MEANINGFUL: it advances
 *     `last_surfaced_at`, increments `surface_count`, and records the surface.
 *
 * TENANT ISOLATION
 * ----------------
 * The write runs on the ambient request-scoped tenant client, inside the
 * caller's `asTenant` scope, so RLS applies exactly as it does to the read that
 * produced these ids. The statement additionally carries an explicit
 * `organization_id = $1` predicate — belt and braces, so a bug in scope
 * propagation cannot write across tenants. No elevated pool, no owner
 * privileges, no RLS weakening.
 *
 * WHY A SAVEPOINT AND NOT JUST TRY/CATCH
 * --------------------------------------
 * `asTenant` runs the whole request in one transaction and buffers the response
 * until COMMIT succeeds. A failed UPDATE would poison that transaction — every
 * later statement fails and COMMIT degrades to ROLLBACK — so the suggestions the
 * user asked for would never be flushed. Catching the JavaScript error is NOT
 * sufficient to prevent that. The write therefore runs inside its own SAVEPOINT
 * (via createSavepointClient, which rewrites BEGIN/COMMIT/ROLLBACK to
 * SAVEPOINT/RELEASE/ROLLBACK TO), so a telemetry failure rolls back only itself
 * and leaves the request transaction healthy and committable.
 *
 * NO CONTENT IS COPIED. Ids and timestamps only — no suggestion text, no
 * control text, no vulnerability description, no prompt, no model output, and
 * no user or session identifier. The table's `userRefColumns` are unchanged, so
 * this adds no individual GDPR export or erasure obligation.
 */

import { requireTenantContext } from "../infra/postgres.js";
import { createSavepointClient } from "../infra/tenantContext.js";
import { logger } from "../infra/logger.js";

/**
 * Repeats inside this window are the same viewing session for our purposes and
 * are not counted. 30 minutes is chosen to absorb ordinary re-renders, tab
 * switches and polling without swallowing a genuine return visit later in the
 * day. It is a product-analytics coalescing rule, not a security control.
 */
export const SURFACE_COALESCE_WINDOW_MS = 30 * 60 * 1000;

/** Product surfaces that can deliver a suggestion. Closed vocabulary. */
export type ProductSurface = "suggestions_list";

/**
 * Record that `suggestionIds` were delivered to `surface` for `organizationId`.
 *
 * NEVER THROWS, and never leaves the caller's transaction unusable. Returns the
 * number of rows the coalescing rule counted as a meaningful surfacing, purely
 * so tests and callers can assert behaviour; callers must not depend on it.
 */
export async function recordSuggestionsSurfaced(
  organizationId: string,
  suggestionIds: ReadonlyArray<string>,
  surface: ProductSurface,
  now: Date = new Date()
): Promise<number> {
  if (suggestionIds.length === 0) return 0;

  let client: ReturnType<typeof createSavepointClient>;
  try {
    client = createSavepointClient(requireTenantContext());
  } catch {
    // Called outside a tenant scope. That is a programming error, not a user
    // problem — log and move on rather than failing the request.
    logger.warn(
      { event: "suggestion_surfaced_no_tenant_scope", organization_id: organizationId },
      "Surfaced telemetry skipped — no active tenant scope"
    );
    return 0;
  }

  const staleBefore = new Date(now.getTime() - SURFACE_COALESCE_WINDOW_MS);

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE signal_match_suggestions
          SET first_surfaced_at     = COALESCE(first_surfaced_at, $3),
              last_surfaced_at      = $3,
              surface_count         = surface_count + 1,
              last_surfaced_surface = $4
        WHERE organization_id = $1
          AND id = ANY($2::uuid[])
          AND (last_surfaced_at IS NULL OR last_surfaced_at <= $5)
        RETURNING id`,
      [organizationId, [...suggestionIds], now, surface, staleBefore]
    );
    await client.query("COMMIT");

    const counted = result.rowCount ?? 0;
    if (counted > 0) {
      logger.info(
        {
          event: "suggestion_surfaced",
          organization_id: organizationId,
          surface,
          suggestions_returned: suggestionIds.length,
          suggestions_counted: counted
        },
        "Control-match suggestions surfaced to a product surface"
      );
    }
    return counted;
  } catch (err) {
    // Roll back to the savepoint so the REQUEST transaction survives and the
    // user still gets their suggestions. This is the whole reason for the
    // savepoint; see the module header.
    await client.query("ROLLBACK").catch(() => {});
    logger.warn(
      { event: "suggestion_surfaced_write_failed", organization_id: organizationId, surface, err },
      "Surfaced telemetry write failed — suggestions still returned, funnel data lost for this view"
    );
    return 0;
  }
}
