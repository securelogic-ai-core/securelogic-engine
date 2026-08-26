/**
 * vendorAssuranceMonitoringWorker.ts — the assurance decision comes back.
 *
 * A vendor decision is a TIME-BOXED judgement about a moving target. Two things
 * deterministically invalidate it:
 *
 *   1. TIME.   The review date (or the decision's own expiry) passes.
 *   2. INTEL.  A human accepts a Critical/High signal-match against the vendor
 *              AFTER the decision — the world changed in a way someone already
 *              verified is about this vendor.
 *
 * Both sweeps are claim-then-emit (the UPDATE selects and marks in one
 * statement), mirroring riskAcceptanceExpiryWorker: a crashed run can never
 * double-notify, and a re-run finds nothing left to claim. Restarting
 * monitoring with a fresh cadence clears the marks and re-arms both.
 *
 * Nothing here calls a model, and nothing here changes a risk number or a
 * workflow state. The sweep RECOMMENDS; reassessment remains a human decision,
 * exactly like the decision it revisits.
 *
 * Org-by-org, inside a per-tenant transaction. There is no cross-tenant sweep —
 * a bug in this loop must not be able to touch two customers.
 */

// M-1 PR-2: the DISTINCT-organization_id scans below are CROSS-ORG BY DESIGN
// (the canonical worker enumeration pattern) — they run on the elevated
// channel; every per-org body stays inside withTenant exactly as before.
import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { vendorAssuranceEnabled } from "../lib/vendorAssuranceFeatureFlag.js";

/** Hourly. Both triggers are date-grained, so this is generous. */
const INTERVAL_MS = 60 * 60 * 1000;

/**
 * TIME sweep: monitoring engagements whose review date or decision expiry has
 * passed are marked overdue, once each.
 */
export async function runEngagementReviewDueSweep(): Promise<{
  organizations: number;
  overdue: number;
}> {
  if (!vendorAssuranceEnabled()) return { organizations: 0, overdue: 0 };

  // Only orgs that actually have a lapsed engagement — most ticks touch nothing.
  const orgs = await pgElevated.query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id
       FROM vendor_engagements
      WHERE status = 'monitoring'
        AND review_overdue_notified_at IS NULL
        AND (next_review_due < CURRENT_DATE
             OR (decision_expires_at IS NOT NULL AND decision_expires_at < CURRENT_DATE))`
  );

  let overdue = 0;

  for (const { organization_id: organizationId } of orgs.rows) {
    try {
      const claimed = await withTenant(organizationId, async () => {
        const res = await pg.query<{
          id: string;
          vendor_id: string;
          next_review_due: string | null;
          decision_expires_at: string | null;
        }>(
          `UPDATE vendor_engagements
              SET review_overdue_notified_at = NOW(), updated_at = NOW()
            WHERE organization_id = $1
              AND status = 'monitoring'
              AND review_overdue_notified_at IS NULL
              AND (next_review_due < CURRENT_DATE
                   OR (decision_expires_at IS NOT NULL AND decision_expires_at < CURRENT_DATE))
            RETURNING id, vendor_id, next_review_due, decision_expires_at`,
          [organizationId]
        );
        return res.rows;
      });

      for (const row of claimed) {
        writeAuditEvent({
          organizationId,
          actorUserId: null, // the sweep runs as the system, not as a person
          eventType: "vendor_engagement.review_overdue",
          resourceType: "vendor_engagement",
          resourceId: row.id,
          payload: {
            vendor_id: row.vendor_id,
            next_review_due: row.next_review_due,
            decision_expires_at: row.decision_expires_at,
          },
          ipAddress: null,
        });
      }
      overdue += claimed.length;
    } catch (err) {
      // Keep going: one tenant's failure must not stop another tenant's
      // reviews from surfacing — a silently stuck sweep leaves stale vendor
      // decisions looking current, the exact failure this worker prevents.
      logger.error(
        { event: "engagement_review_due_sweep_failed", organizationId, err },
        "Engagement review-due sweep failed for organization"
      );
    }
  }

  if (overdue > 0) {
    logger.info(
      { event: "engagement_review_due_sweep_complete", organizations: orgs.rowCount, overdue },
      "Engagement review-due sweep complete"
    );
  }
  return { organizations: orgs.rowCount ?? 0, overdue };
}

const SEVERITY_RANK: Record<string, number> = { Critical: 2, High: 1 };

/**
 * INTEL sweep: accepted Critical/High vendor signal-matches newer than the
 * decision recommend a reassessment, once per engagement until re-armed.
 *
 * Accepted only. The matcher's own guesses stay in the suggestion queue; this
 * trigger fires on the human confirmation, so the recommendation inherits the
 * confirmation's credibility.
 */
export async function runEngagementIntelligenceSweep(): Promise<{
  organizations: number;
  recommended: number;
}> {
  if (!vendorAssuranceEnabled()) return { organizations: 0, recommended: 0 };

  const orgs = await pgElevated.query<{ organization_id: string }>(
    `SELECT DISTINCT e.organization_id
       FROM vendor_engagements e
       JOIN signal_match_suggestions m
         ON m.organization_id = e.organization_id
        AND m.target_type = 'vendor'
        AND m.target_id = e.vendor_id
        AND m.accepted_at IS NOT NULL
        AND m.accepted_at > e.decided_at
       JOIN cyber_signals s
         ON s.id = m.signal_id AND s.severity IN ('Critical', 'High')
      WHERE e.status = 'monitoring'
        AND e.reassessment_recommended_at IS NULL`
  );

  let recommended = 0;

  for (const { organization_id: organizationId } of orgs.rows) {
    try {
      const marked = await withTenant(organizationId, async () => {
        const intel = await pg.query<{
          engagement_id: string;
          vendor_id: string;
          signal_count: string;
          top_rank: number;
          decided_on: string;
        }>(
          `SELECT e.id AS engagement_id, e.vendor_id,
                  COUNT(*)::text AS signal_count,
                  MAX(CASE s.severity WHEN 'Critical' THEN 2 ELSE 1 END) AS top_rank,
                  to_char(e.decided_at, 'YYYY-MM-DD') AS decided_on
             FROM vendor_engagements e
             JOIN signal_match_suggestions m
               ON m.organization_id = e.organization_id
              AND m.target_type = 'vendor'
              AND m.target_id = e.vendor_id
              AND m.accepted_at IS NOT NULL
              AND m.accepted_at > e.decided_at
             JOIN cyber_signals s
               ON s.id = m.signal_id AND s.severity IN ('Critical', 'High')
            WHERE e.organization_id = $1
              AND e.status = 'monitoring'
              AND e.reassessment_recommended_at IS NULL
            GROUP BY e.id, e.vendor_id, e.decided_at`,
          [organizationId]
        );

        const done: typeof intel.rows = [];
        for (const row of intel.rows) {
          const top = row.top_rank >= SEVERITY_RANK["Critical"]! ? "Critical" : "High";
          const reason =
            `${row.signal_count} accepted intelligence signal(s) matched this vendor ` +
            `after the decision on ${row.decided_on} (highest severity ${top}). ` +
            `Review whether the assessed posture still holds; start a targeted ` +
            `reassessment if it may not.`;
          // Re-guarded on NULL so a concurrent re-arm between SELECT and UPDATE
          // wins — the recommendation is dropped, not resurrected.
          const updated = await pg.query(
            `UPDATE vendor_engagements
                SET reassessment_recommended_at = NOW(), reassessment_reason = $3,
                    updated_at = NOW()
              WHERE id = $1 AND organization_id = $2
                AND status = 'monitoring' AND reassessment_recommended_at IS NULL`,
            [row.engagement_id, organizationId, reason]
          );
          if (updated.rowCount) done.push(row);
        }
        return done;
      });

      for (const row of marked) {
        writeAuditEvent({
          organizationId,
          actorUserId: null,
          eventType: "vendor_engagement.reassessment_recommended",
          resourceType: "vendor_engagement",
          resourceId: row.engagement_id,
          payload: {
            vendor_id: row.vendor_id,
            accepted_signal_count: Number(row.signal_count),
            highest_severity: row.top_rank >= 2 ? "Critical" : "High",
          },
          ipAddress: null,
        });
      }
      recommended += marked.length;
    } catch (err) {
      logger.error(
        { event: "engagement_intelligence_sweep_failed", organizationId, err },
        "Engagement intelligence sweep failed for organization"
      );
    }
  }

  if (recommended > 0) {
    logger.info(
      {
        event: "engagement_intelligence_sweep_complete",
        organizations: orgs.rowCount,
        recommended,
      },
      "Engagement intelligence sweep complete"
    );
  }
  return { organizations: orgs.rowCount ?? 0, recommended };
}

export function startVendorAssuranceMonitoringWorker(): void {
  if (!vendorAssuranceEnabled()) {
    logger.info(
      { event: "vendor_assurance_monitoring_worker_disabled" },
      "Vendor-assurance monitoring worker: feature flag off — not started"
    );
    return;
  }

  const tick = (): void => {
    void runEngagementReviewDueSweep().catch((err) => {
      logger.error({ event: "engagement_review_due_tick_failed", err }, "Review-due tick failed");
    });
    void runEngagementIntelligenceSweep().catch((err) => {
      logger.error(
        { event: "engagement_intelligence_tick_failed", err },
        "Intelligence tick failed"
      );
    });
  };

  // Not on boot: a deploy should not stampede the sweep across every tenant
  // while the process is still warming. The first tick lands one interval in.
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();

  logger.info(
    { event: "vendor_assurance_monitoring_worker_started", intervalMs: INTERVAL_MS },
    "Vendor-assurance monitoring worker started"
  );
}
