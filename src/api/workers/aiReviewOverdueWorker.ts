/**
 * aiReviewOverdueWorker.ts — an AI system's review date passes, someone is told.
 *
 * T2-C gave ai_systems the vendor-engagement cadence pair and ruled overdue is
 * COMPUTED AT READ — the read routes have surfaced `review_overdue` since the
 * columns landed, so posture never depends on this worker having fired. What
 * this sweep adds is the NOTIFICATION: the durable, once-per-lapse record that
 * the platform noticed and said so, instead of waiting for someone to load the
 * page.
 *
 * Mirrors runEngagementReviewDueSweep (vendorAssuranceMonitoringWorker) — the
 * sibling 20261037 modeled its columns on — exactly:
 *   - materialised claim-then-notify: the UPDATE both selects and marks the
 *     row (review_overdue_notified_at, 20261040), so a crashed run can never
 *     double-notify and a re-run finds nothing left to claim;
 *   - the notification is an AUDIT EVENT (`ai_system.review_overdue`, system
 *     actor), the same artifact the vendor sweep writes — not an email; email
 *     delivery is its own dark-flagged lane everywhere in this platform and
 *     is not smuggled in through a sweep;
 *   - SWEEP NOTIFIES, NEVER FLIPS: next_review_due, the use decision, and
 *     every other governance fact are untouched. The one write is the marker.
 *   - org-by-org inside per-tenant transactions; the cross-org enumeration is
 *     the canonical DISTINCT-organization_id worker pattern on the elevated
 *     channel, and one tenant's failure never stops another's notifications.
 *
 * RE-ARM lives in the PATCH route: writing next_review_due clears the marker
 * — a fresh review date answers the previous notification, and the next lapse
 * notifies again.
 *
 * Self-gates on SECURELOGIC_AI_REVIEW_SWEEP_ENABLED, default-DENY everywhere
 * including non-production: a sweep that writes audit events across every
 * tenant must never wake by accident. DELIBERATELY NOT DECLARED in render.yaml
 * on this branch (R-1 §G: the flag reconciliation is release evidence over the
 * frozen candidate) — declare the key, value "false", in IaC at merge time;
 * undeclared and "false" are identical: dark by construction.
 */

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";

/** Once an hour. Due dates are DATEs, so this is 24x more often than needed. */
const INTERVAL_MS = 60 * 60 * 1000;

export function aiReviewSweepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_AI_REVIEW_SWEEP_ENABLED"] === "true";
}

export async function runAiReviewOverdueSweep(): Promise<{
  organizations: number;
  overdue: number;
}> {
  if (!aiReviewSweepEnabled()) return { organizations: 0, overdue: 0 };

  // Only orgs that actually have a lapsed, un-notified review — the
  // overwhelming majority of ticks touch nothing and open zero tenant
  // transactions. Rides 20261037's partial (organization_id, next_review_due)
  // index.
  const orgs = await pgElevated.query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id
       FROM ai_systems
      WHERE next_review_due IS NOT NULL
        AND next_review_due < CURRENT_DATE
        AND review_overdue_notified_at IS NULL`
  );

  let overdue = 0;

  for (const { organization_id: organizationId } of orgs.rows) {
    try {
      const claimed = await withTenant(organizationId, async () => {
        const res = await pg.query<{
          id: string;
          name: string;
          next_review_due: string;
          review_cadence_days: number | null;
          business_owner_user_id: string | null;
          owner_user_id: string | null;
        }>(
          `UPDATE ai_systems
              SET review_overdue_notified_at = NOW(), updated_at = NOW()
            WHERE organization_id = $1
              AND next_review_due IS NOT NULL
              AND next_review_due < CURRENT_DATE
              AND review_overdue_notified_at IS NULL
            RETURNING id, name, to_char(next_review_due, 'YYYY-MM-DD') AS next_review_due,
                      review_cadence_days, business_owner_user_id, owner_user_id`,
          [organizationId]
        );
        return res.rows;
      });

      for (const row of claimed) {
        writeAuditEvent({
          organizationId,
          actorUserId: null, // the sweep runs as the system, not as a person
          eventType: "ai_system.review_overdue",
          resourceType: "ai_system",
          resourceId: row.id,
          payload: {
            name: row.name,
            next_review_due: row.next_review_due,
            review_cadence_days: row.review_cadence_days,
            // Who should act: the accountable business owner where named,
            // with the operational owner alongside — resolution to a person
            // is the reader's job, the sweep only records the facts.
            business_owner_user_id: row.business_owner_user_id,
            owner_user_id: row.owner_user_id,
          },
          ipAddress: null,
        });
      }
      overdue += claimed.length;
    } catch (err) {
      // Keep going: one tenant's failure must not stop another tenant's
      // reviews from surfacing — a silently stuck sweep leaves overdue AI
      // reviews looking handled, the exact failure this worker prevents.
      logger.error(
        { event: "ai_review_overdue_sweep_failed", organizationId, err },
        "AI review-overdue sweep failed for organization"
      );
    }
  }

  if (overdue > 0) {
    logger.info(
      { event: "ai_review_overdue_sweep_complete", organizations: orgs.rowCount, overdue },
      "AI review-overdue sweep complete"
    );
  }
  return { organizations: orgs.rowCount ?? 0, overdue };
}

export function startAiReviewOverdueWorker(): void {
  const tick = (): void => {
    void runAiReviewOverdueSweep().catch((err) => {
      logger.error(
        { event: "ai_review_overdue_tick_failed", err },
        "AI review-overdue tick failed"
      );
    });
  };

  // Not on boot: a deploy should not stampede the sweep across every tenant
  // while the process is still warming. The first tick lands one interval in.
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();

  logger.info(
    { event: "ai_review_overdue_worker_started", intervalMs: INTERVAL_MS },
    "AI review-overdue worker started (each tick self-gates on SECURELOGIC_AI_REVIEW_SWEEP_ENABLED)"
  );
}
