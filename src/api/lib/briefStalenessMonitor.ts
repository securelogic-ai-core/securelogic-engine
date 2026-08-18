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
 * SEMANTICS — weekly-edition completeness, not brief age
 * ------------------------------------------------------
 * - An org is flagged when it is MISSING THE CURRENT WEEKLY EDITION: it has no
 *   published brief generated at/after currentBriefWeekStart() (the most
 *   recent Tuesday 07:00 UTC). This is the SAME predicate the catch-up uses to
 *   decide what to reconcile (sqlMissingCurrentBrief), so monitoring and
 *   recovery can never disagree about which orgs are behind.
 * - It replaces an age threshold (the former BRIEF_STALE_AFTER_DAYS = 8) that
 *   could hide a real miss for over a week: an org created 3 days before its
 *   first run was excluded by the young-org carve-out, so a missed FIRST
 *   edition was invisible until the org itself aged past 8 days. Observed
 *   live: staging 2026-08-11, where an interrupted run left two orgs without
 *   the week's brief but only the older one alerted.
 * - Orgs created INSIDE the current window are still excluded (created_at <
 *   weekStart) — their first edition is legitimately the next Tuesday run.
 *   This is a window carve-out, not an age carve-out: an org created before
 *   the window is checked on its very first edition.
 * - A grace period (BRIEF_WINDOW_GRACE_HOURS) suppresses alerts while the
 *   week's run may still legitimately be in flight — the sequential run takes
 *   hours (~4.5 h observed on staging with 13 orgs). Before the grace elapses
 *   the sweep reports nothing rather than alerting on orgs still queued.
 * - Alerts go to the operator webhook (sendFailureAlert) — operational
 *   observability only, never customer email. Re-alerts daily while the
 *   condition persists: a missing edition is an outage of the platform's core
 *   briefing promise, and outages page until fixed.
 * - READ-ONLY: this module never generates, sends, schedules, or writes
 *   anything. Recovery is the catch-up's job (briefCatchup, flag-gated).
 * - Cross-org read by design → pgElevated (registered in
 *   docs/A04-G1-table-classification.md).
 * - Best-effort: never throws into the cron tick.
 *
 * NOTE: app/src/lib/briefStaleness.ts STALE_AFTER_DAYS = 8 is a DIFFERENT,
 * customer-facing question ("is the brief I am looking at old?") and remains
 * an age rule. The two are intentionally no longer coupled.
 */

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { sendFailureAlert } from "../infra/alerting.js";
import { sqlBriefEligibleOrg } from "./briefEligibility.js";
import { sqlMissingCurrentBrief } from "./briefWeeklyEdition.js";
import { currentBriefWeekStart } from "./briefSendWindow.js";

/**
 * How long after a weekly window opens before a missing edition is alertable.
 * Covers the legitimate duration of the sequential run (hours) plus slack for
 * a catch-up on a later boot, so the sweep reports genuine misses rather than
 * work still in progress.
 */
export const BRIEF_WINDOW_GRACE_HOURS = 24;

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
 * Eligible orgs that existed before the current weekly window opened and are
 * missing that window's published edition. Returns [] while the window is
 * younger than BRIEF_WINDOW_GRACE_HOURS (the run may still be in flight).
 *
 * The LEFT JOIN exists only to report each org's newest prior brief in the
 * alert ("never" when it has none) — the missing-edition decision itself is
 * the shared sqlMissingCurrentBrief predicate. Exported for unit testing.
 */
export async function findStaleBriefOrgs(now: Date = new Date()): Promise<StaleBriefOrg[]> {
  const weekStart = currentBriefWeekStart(now);
  const graceEndsAt = weekStart.getTime() + BRIEF_WINDOW_GRACE_HOURS * 60 * 60 * 1000;

  if (now.getTime() < graceEndsAt) {
    return [];
  }

  const result = await pgElevated.query<StaleBriefOrg>(
    `SELECT o.id, o.name, MAX(b.generated_at)::text AS newest_generated_at
     FROM organizations o
     LEFT JOIN intelligence_briefs b
       ON b.organization_id = o.id AND b.status = 'published'
     WHERE ${sqlBriefEligibleOrg("o")}
       AND o.created_at < $1
       AND ${sqlMissingCurrentBrief("o", "$1")}
     GROUP BY o.id, o.name
     ORDER BY o.id`,
    [weekStart.toISOString()]
  );
  return result.rows;
}

/**
 * Daily staleness sweep: detect and alert. Never throws.
 */
export async function runBriefStalenessCheck(
  now: Date = new Date()
): Promise<BriefStalenessSummary> {
  let staleOrgs: StaleBriefOrg[];

  try {
    staleOrgs = await findStaleBriefOrgs(now);
  } catch (err) {
    logger.error(
      { event: "brief_staleness_query_failed", err },
      "Brief staleness sweep: query failed (non-fatal)"
    );
    return { staleOrgs: [], alerted: false };
  }

  const weekStart = currentBriefWeekStart(now);

  if (staleOrgs.length === 0) {
    logger.info(
      { event: "brief_staleness_ok", weekStart: weekStart.toISOString() },
      "Brief staleness sweep: every eligible org has the current weekly published brief"
    );
    return { staleOrgs, alerted: false };
  }

  const shown = staleOrgs
    .slice(0, MAX_ORGS_IN_ALERT)
    .map((o) => `${o.name} (newest: ${o.newest_generated_at ?? "never"})`)
    .join("; ");
  const overflow = staleOrgs.length - MAX_ORGS_IN_ALERT;
  const message =
    `${staleOrgs.length} active org(s) are missing the current weekly Intelligence Brief ` +
    `edition (window opened ${weekStart.toISOString()}): ${shown}` +
    `${overflow > 0 ? ` (+${overflow} more)` : ""}. ` +
    `Generation is an entitlement of every active org — check the Tuesday scheduler run ` +
    `for an interrupted or missed pass.`;

  logger.error(
    {
      event: "brief_staleness_detected",
      week_start: weekStart.toISOString(),
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
