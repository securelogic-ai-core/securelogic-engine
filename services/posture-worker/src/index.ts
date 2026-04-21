/**
 * Posture Worker — scheduled background job.
 *
 * Computes and persists a posture snapshot for every active organisation
 * every 6 hours. Uses the same computation engine as POST /api/posture/snapshot
 * via the shared computeAndSavePostureSnapshot lib function.
 *
 * Run order:
 *   1. Compute immediately on startup.
 *   2. Then repeat every 6 hours.
 *
 * One org failure never stops other orgs — errors are caught per-org.
 */

import { pg } from "../../../src/api/infra/postgres.js";
import { logger } from "../../../src/api/infra/logger.js";
import { computeAndSavePostureSnapshot } from "../../../src/api/lib/postureSnapshot.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

async function computeAllSnapshots(): Promise<void> {
  const startedAt = Date.now();
  logger.info({ event: "posture_worker_cycle_start" }, "Posture worker cycle starting");

  let activeOrgs: string[];
  try {
    const result = await pg.query<{ id: string }>(
      `SELECT id FROM organizations WHERE status = 'active'`
    );
    activeOrgs = result.rows.map((r) => r.id);
  } catch (err) {
    logger.error(
      { event: "posture_worker_org_query_failed", err },
      "Failed to query active organisations — aborting cycle"
    );
    return;
  }

  logger.info(
    { event: "posture_worker_orgs_found", count: activeOrgs.length },
    `Computing posture snapshots for ${activeOrgs.length} organisation(s)`
  );

  let successCount = 0;
  let failureCount = 0;

  for (const orgId of activeOrgs) {
    try {
      const result = await computeAndSavePostureSnapshot(orgId);
      successCount++;
      logger.info(
        {
          event: "posture_worker_snapshot_ok",
          organizationId: orgId,
          snapshotId: result.snapshotId,
          overallScore: result.overallScore,
          domainCount: result.domainScores.length,
        },
        `Snapshot written for org ${orgId}`
      );
    } catch (err) {
      failureCount++;
      logger.error(
        { event: "posture_worker_snapshot_failed", organizationId: orgId, err },
        `Snapshot failed for org ${orgId}`
      );
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info(
    {
      event: "posture_worker_cycle_complete",
      successCount,
      failureCount,
      durationMs,
    },
    `Posture worker cycle complete — ${successCount} ok, ${failureCount} failed (${durationMs}ms)`
  );
}

async function start(): Promise<void> {
  logger.info({ event: "posture_worker_start" }, "Posture worker started");

  await computeAllSnapshots();

  setInterval(async () => {
    try {
      await computeAllSnapshots();
    } catch (err) {
      logger.error(
        { event: "posture_worker_cycle_unhandled_error", err },
        "Unhandled error in posture worker cycle"
      );
    }
  }, SIX_HOURS_MS);
}

start().catch((err) => {
  logger.error(
    { event: "posture_worker_startup_failed", err },
    "Posture worker startup failed"
  );
  process.exit(1);
});
