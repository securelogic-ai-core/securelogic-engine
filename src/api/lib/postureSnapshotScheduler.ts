/**
 * postureSnapshotScheduler.ts — continuous posture history.
 *
 * "Monitor posture over time" needs a snapshot row per org per day. Before
 * this sweep, posture_snapshots advanced only when (a) someone clicked the
 * manual snapshot route or (b) signal processing recomputed posture for an
 * affected org. A quiet org — no matched signals, nobody clicking — froze:
 * the trend chart had holes and the weekly summary email read a stale score.
 *
 * The sweep is idempotent by construction: computeAndSavePostureSnapshot
 * upserts on (organization_id, snapshot_date), so a day that already got a
 * signal-driven or manual snapshot is refreshed, never duplicated.
 *
 * Deliberately does NOT emit the posture.snapshot_created webhook — that
 * event fires only from the customer-initiated route, matching the
 * signal-driven path. A daily cron emitting one webhook per org per day
 * would be schedule noise, not signal.
 *
 * Shape mirrors summaryScheduler.ts: org enumeration on the elevated pool
 * (cross-org scan), each org's compute inside withTenant (RLS-correct,
 * single-org provable), per-org error isolation so one tenant's failure
 * never freezes another tenant's history.
 */

import { pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { computeAndSavePostureSnapshot } from "./postureSnapshot.js";

export async function runDailyPostureSnapshots(): Promise<{
  orgsProcessed: number;
  snapshotsWritten: number;
  failures: number;
}> {
  const orgsResult = await pgElevated.query<{ id: string }>(
    `SELECT id FROM organizations WHERE status = 'active'`
  );

  let snapshotsWritten = 0;
  let failures = 0;

  for (const org of orgsResult.rows) {
    try {
      await withTenant(org.id, async () => {
        await computeAndSavePostureSnapshot(org.id);
      });
      snapshotsWritten += 1;
    } catch (err) {
      failures += 1;
      logger.error(
        { event: "daily_posture_snapshot_failed", organizationId: org.id, err },
        "Daily posture snapshot failed for organization"
      );
    }
  }

  logger.info(
    {
      event: "daily_posture_snapshot_complete",
      orgsProcessed: orgsResult.rowCount ?? 0,
      snapshotsWritten,
      failures,
    },
    "Daily posture snapshot sweep complete"
  );

  return { orgsProcessed: orgsResult.rowCount ?? 0, snapshotsWritten, failures };
}
