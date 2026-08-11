/**
 * briefStalenessMonitor.ts — daily sweep that detects active organizations
 * whose newest published Intelligence Brief is older than the weekly cadence
 * allows (or who have never received one).
 *
 * WHY
 * ---
 * Brief generation is an organizational entitlement (ADR-0007): every active
 * org gets a current in-platform brief every week. The delivery-health check
 * (briefDeliveryHealth) observes a single scheduler RUN — but a cron that
 * silently never fires produces no run to observe. This sweep closes that gap
 * by checking the OUTCOME directly in the data: for each active org, how old
 * is the newest published brief? It is the server-side promotion of the app's
 * cosmetic staleness label (app/src/lib/briefStaleness.ts) into an operator
 * alert.
 *
 * SEMANTICS
 * ---------
 * - Threshold mirrors the app's STALE_AFTER_DAYS = 8 (weekly cadence + one
 *   day of slack). Keep the two constants in sync.
 * - Orgs younger than the threshold are excluded: a customer who signed up
 *   yesterday legitimately has no brief until the next Tuesday run.
 * - Alerts go to the operator webhook (sendFailureAlert) — operational
 *   observability only, never customer email. Re-alerts daily while the
 *   condition persists: a stale brief is an outage of the platform's core
 *   briefing promise, and outages page until fixed.
 * - Cross-org read by design → pgElevated (registered in
 *   docs/A04-G1-table-classification.md).
 * - Best-effort: never throws into the cron tick.
 */

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { sendFailureAlert } from "../infra/alerting.js";
import { sqlBriefEligibleOrg } from "./briefEligibility.js";

/**
 * Days after which an active org's newest published brief counts as stale.
 * MUST stay in sync with STALE_AFTER_DAYS in app/src/lib/briefStaleness.ts
 * (the customer-facing "this brief is N weeks old" label).
 */
export const BRIEF_STALE_AFTER_DAYS = 8;

/** How many stale orgs to name in the alert before truncating. */
const MAX_ORGS_IN_ALERT = 5;

export type StaleBriefOrg = {
  id: string;
  name: string;
  /** ISO timestamp of the newest published brief, or null if the org has none. */
  newest_generated_at: string | null;
};

export type BriefStalenessSummary = {
  staleOrgs: StaleBriefOrg[];
  alerted: boolean;
};

/**
 * Find active orgs (older than the threshold themselves) whose newest
 * published brief is missing or older than BRIEF_STALE_AFTER_DAYS.
 * Exported for unit testing.
 */
export async function findStaleBriefOrgs(): Promise<StaleBriefOrg[]> {
  const result = await pgElevated.query<StaleBriefOrg>(
    `SELECT o.id, o.name, MAX(b.generated_at)::text AS newest_generated_at
     FROM organizations o
     LEFT JOIN intelligence_briefs b
       ON b.organization_id = o.id AND b.status = 'published'
     WHERE ${sqlBriefEligibleOrg("o")}
       AND o.created_at < NOW() - make_interval(days => $1)
     GROUP BY o.id, o.name
     HAVING MAX(b.generated_at) IS NULL
         OR MAX(b.generated_at) < NOW() - make_interval(days => $1)
     ORDER BY o.id`,
    [BRIEF_STALE_AFTER_DAYS]
  );
  return result.rows;
}

/**
 * Daily staleness sweep: detect and alert. Never throws.
 */
export async function runBriefStalenessCheck(): Promise<BriefStalenessSummary> {
  let staleOrgs: StaleBriefOrg[];

  try {
    staleOrgs = await findStaleBriefOrgs();
  } catch (err) {
    logger.error(
      { event: "brief_staleness_query_failed", err },
      "Brief staleness sweep: query failed (non-fatal)"
    );
    return { staleOrgs: [], alerted: false };
  }

  if (staleOrgs.length === 0) {
    logger.info(
      { event: "brief_staleness_ok" },
      "Brief staleness sweep: every active org has a current published brief"
    );
    return { staleOrgs, alerted: false };
  }

  const shown = staleOrgs
    .slice(0, MAX_ORGS_IN_ALERT)
    .map((o) => `${o.name} (newest: ${o.newest_generated_at ?? "never"})`)
    .join("; ");
  const overflow = staleOrgs.length - MAX_ORGS_IN_ALERT;
  const message =
    `${staleOrgs.length} active org(s) have no published Intelligence Brief newer than ` +
    `${BRIEF_STALE_AFTER_DAYS} days: ${shown}${overflow > 0 ? ` (+${overflow} more)` : ""}. ` +
    `Generation is an entitlement of every active org — check the Tuesday scheduler run.`;

  logger.error(
    {
      event: "brief_staleness_detected",
      stale_org_count: staleOrgs.length,
      stale_org_ids: staleOrgs.map((o) => o.id)
    },
    message
  );

  let alerted = false;
  try {
    await sendFailureAlert("intelligence-brief-staleness", `[error] ${message}`);
    alerted = true;
  } catch (err) {
    logger.warn(
      { event: "brief_staleness_alert_failed", err },
      "Failed to send brief-staleness alert (non-fatal)"
    );
  }

  return { staleOrgs, alerted };
}
