/**
 * briefCatchup.ts — recover a missed or interrupted weekly Intelligence Brief run.
 *
 * WHY
 * ---
 * The Brief's sole automated trigger is an in-process node-cron in the engine
 * web service (schedulerRunner, "0 7 * * 2"). One firing opportunity per week,
 * no external retry — and the run itself is a sequential, hours-long loop over
 * orgs. TWO failure modes drop editions silently:
 *   1. The process is not alive at Tuesday 07:00 UTC (deploy/restart/crash
 *      spanning the fire time) — the run never starts.
 *   2. The run starts and is killed mid-loop (a deploy's SIGTERM during the
 *      multi-hour run) — orgs early in the ORDER-BY-id loop publish, the tail
 *      never generates. Observed live on staging 2026-08-11: 9 of 12 orgs
 *      published, then an 11:32Z redeploy killed the run.
 * This module lets a later boot recover BOTH: it checks per-org completeness
 * of the current weekly edition, not merely "did any brief generate".
 *
 * WHAT
 * ----
 * On boot, if the catch-up flag is on AND any eligible org is missing a
 * published brief for the current weekly window (generated_at >= the most
 * recent Tuesday 07:00 UTC — currentBriefWeekStart), run the scheduler once
 * through the shared overlap lock. The scheduler's own per-org idempotency
 * skip (briefScheduler, scheduler_org_skipped_already_current) regenerates
 * ONLY the missing orgs — completed orgs are never duplicated.
 *
 * CADENCE POLICY (operator-ratified 2026-08-18)
 * ---------------------------------------------
 * - Catch-up GENERATION may run on any weekday within the cadence week
 *   (Wednesday+ after an interrupted Tuesday run included): a missing weekly
 *   edition is recovered whenever it is detected, until the next Tuesday
 *   window supersedes it.
 * - The EMAIL send-day control is unchanged and lives where it always has:
 *   runScheduler() gates sendBrief() on isBriefSendDay() (Tuesday UTC), so a
 *   Wednesday+ catch-up generates and publishes in-platform but sends no
 *   email. Catch-up generation never implies an out-of-window email.
 * - Orgs created after the current window's start (mid-week signups) are NOT
 *   counted as missing — their first edition is the next Tuesday run, the same
 *   young-org carve-out the staleness monitor applies. Without this, every
 *   boot after a mid-week signup would trigger a full scheduler run.
 *
 * SAFETY
 * ------
 * - DARK by default (SECURELOGIC_BRIEF_CATCHUP_ENABLED), operator-owned.
 * - Completeness is derived from PUBLISHED intelligence_briefs rows, NOT from
 *   intelligence_brief_sends. Generation is an organizational entitlement
 *   decoupled from email recipients (ADR-0007), so a legitimate run with zero
 *   recipients records no sends — send-based detection would re-run the
 *   scheduler on every boot and generate duplicate briefs. Missed/failed
 *   DELIVERY is the delivery-health alert's job (briefDeliveryHealth), not
 *   catch-up's.
 * - Even if it runs after a partial send, briefEmailSender's idempotency
 *   guard means no subscriber is emailed twice.
 * - Cross-org read by design → pgElevated (same enumeration class as
 *   briefEligibility and the staleness sweep).
 * - Best-effort: never throws into the boot sequence.
 */

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { currentBriefWeekStart } from "./briefSendWindow.js";
import { briefCatchupEnabled } from "./briefCatchupFeatureFlag.js";
import { sqlBriefEligibleOrg } from "./briefEligibility.js";
import { sqlMissingCurrentBrief } from "./briefWeeklyEdition.js";
import { runSchedulerGuarded } from "./schedulerRunner.js";

/** How many missing org ids to name in the trigger log before truncating. */
const MAX_ORGS_IN_LOG = 10;

/**
 * Eligible orgs missing a published brief for the weekly window containing
 * `now`. An org counts as missing only when ALL hold:
 *   - it satisfies the shared brief-eligibility predicate (status = 'active');
 *   - it existed before the window started (created_at < weekStart) — the
 *     mid-week-signup carve-out documented above;
 *   - it has no published brief with generated_at >= weekStart.
 *
 * Exported for unit testing.
 */
export async function findCatchupMissingOrgIds(now: Date): Promise<string[]> {
  const weekStart = currentBriefWeekStart(now);
  const result = await pgElevated.query<{ id: string }>(
    `SELECT o.id
     FROM organizations o
     WHERE ${sqlBriefEligibleOrg("o")}
       AND o.created_at < $1
       AND ${sqlMissingCurrentBrief("o", "$1")}
     ORDER BY o.id`,
    [weekStart.toISOString()]
  );
  return result.rows.map((r) => r.id);
}

export type CatchupResult = { ran: boolean; reason: string };

/**
 * Run the Brief scheduler once if any eligible org is missing this week's
 * edition (never started OR interrupted mid-run).
 *
 * Safe to call unconditionally at server boot: it self-gates on the DARK flag
 * and never throws.
 */
export async function runBriefCatchupIfMissed(
  now: Date = new Date()
): Promise<CatchupResult> {
  if (!briefCatchupEnabled()) {
    // Zero DB access while dark — same discipline as the other self-gating workers.
    return { ran: false, reason: "disabled" };
  }

  const weekStart = currentBriefWeekStart(now);

  let missingOrgIds: string[];
  try {
    missingOrgIds = await findCatchupMissingOrgIds(now);
  } catch (err) {
    logger.error(
      { event: "brief_catchup_query_failed", err },
      "Brief catch-up: failed to query weekly-edition completeness — skipping (non-fatal)"
    );
    return { ran: false, reason: "query_failed" };
  }

  if (missingOrgIds.length === 0) {
    logger.info(
      { event: "brief_catchup_not_needed", weekStart: weekStart.toISOString() },
      "Brief catch-up: every eligible org already has this week's published brief — nothing to recover"
    );
    return { ran: false, reason: "week_complete" };
  }

  logger.warn(
    {
      event: "brief_catchup_triggered",
      weekStart: weekStart.toISOString(),
      missingOrgCount: missingOrgIds.length,
      missingOrgIds: missingOrgIds.slice(0, MAX_ORGS_IN_LOG)
    },
    "Brief catch-up: eligible org(s) missing this week's edition — running the scheduler to reconcile (per-org idempotency skips completed orgs; email remains Tuesday-gated)"
  );

  // Runs through the shared overlap lock; the scheduler's per-org skip plus
  // briefEmailSender's idempotency prevent any duplicate brief or double-send.
  await runSchedulerGuarded("catchup");

  return { ran: true, reason: "recovered" };
}
