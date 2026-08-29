/**
 * vendorRiskHistoryWorker.ts — VA-7: the daily vendor-risk snapshot worker.
 * Persists every org's per-vendor risk capture into vendor_risk_snapshots so
 * the vendor trend surface has a real time series. The vendor twin of
 * riskHistoryWorker.ts (ERIP F2), wired the same way: registered always in
 * server.ts, cross-org fan-out over the elevated channel, each org's capture
 * inside its own withTenant transaction.
 *
 * Deliberately UNGATED (a documented divergence from riskHistoryWorker, whose
 * flags exist because its rollup reads flag-gated views): this sweep reads
 * only core, always-present tables (vendors / findings / vendor_assessments /
 * vendor_reviews / vendor_engagements) and writes one derived row per vendor
 * per day. The entire point of the substrate is that history CANNOT be
 * backfilled — every day it sits behind a dark flag is a day of series lost
 * for every tenant, so it starts accumulating the day it deploys.
 */

import { schedule } from "node-cron";

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { snapshotVendorRiskForOrg } from "../lib/vendorRiskHistoryStore.js";

export interface VendorRiskHistoryWorkerDeps {
  /** Injectable capture date (YYYY-MM-DD); defaults to today (UTC). */
  today?: () => string;
  /** Loop guard for tests / shutdown. */
  shouldContinue?: () => boolean;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Capture every organization's vendors for the given day. Never throws — a
 * per-org failure is logged and the sweep continues (one tenant's bad data
 * must not cost every other tenant its day of history). Returns the number of
 * orgs captured.
 */
export async function runVendorRiskHistorySnapshot(
  deps: VendorRiskHistoryWorkerDeps = {}
): Promise<number> {
  const date = (deps.today ?? todayUtc)();

  const orgs = await pgElevated.query<{ id: string }>(`SELECT id FROM organizations`);
  let snapshotted = 0;
  let vendors = 0;
  for (const org of orgs.rows) {
    if (deps.shouldContinue && !deps.shouldContinue()) break;
    try {
      const captured = await withTenant(org.id, () => snapshotVendorRiskForOrg(org.id, date));
      vendors += captured;
      snapshotted += 1;
    } catch (err) {
      logger.error(
        { event: "vendor_risk_history_snapshot_org_failed", org_id: org.id, date, err },
        "vendor-risk-history snapshot failed for one org; continuing"
      );
    }
  }
  if (orgs.rows.length > 0) {
    logger.info(
      { event: "vendor_risk_history_snapshot_complete", date, orgs: orgs.rows.length, snapshotted, vendors },
      "vendor-risk-history daily snapshot complete"
    );
  }
  return snapshotted;
}

let isSnapshotting = false;

/**
 * Register the daily snapshot cron (03:25 UTC — beside the risk-history
 * snapshot at 03:15, off the top of the hour, staggered so the two daily
 * history sweeps never contend for the same tick). Uses the same
 * `pg`/`pgElevated` proxies as the other workers; the initial import touches
 * nothing until the cron fires.
 */
export function startVendorRiskHistoryWorker(): void {
  // Touch pg so a lint/tree-shake never drops the shared proxy import; the real
  // work happens in the snapshot under withTenant.
  void pg;
  schedule("25 3 * * *", () => {
    if (isSnapshotting) {
      logger.warn(
        { event: "vendor_risk_history_tick_overlap_skipped" },
        "vendor-risk-history worker: previous snapshot still running"
      );
      return;
    }
    isSnapshotting = true;
    void runVendorRiskHistorySnapshot()
      .catch((err) =>
        logger.error({ event: "vendor_risk_history_tick_error", err }, "vendor-risk-history worker tick failed")
      )
      .finally(() => {
        isSnapshotting = false;
      });
  });
  logger.info(
    { event: "vendor_risk_history_worker_registered", schedule: "25 3 * * * (daily 03:25 UTC)" },
    "Vendor-risk-history snapshot worker registered (ungated — reads core tables only)"
  );
}
