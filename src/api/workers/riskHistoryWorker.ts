/**
 * riskHistoryWorker.ts — ERIP F2: the daily risk-history snapshot worker.
 * Persists each org's dimensional risk rollup into risk_history so Executive
 * trends (E4) and the predictive feature store (E5) have a real time series.
 *
 * Registered always; every tick self-gates on the Risk-Intelligence flag AND
 * the asset-registry flag (the rollup reads asset_registry_v) — zero DB access
 * while either is off. Runs once a day (a snapshot per calendar day; the store
 * upserts, so multiple ticks in a day refresh the same row). Cross-org fan-out
 * over the elevated channel (the brief-scheduler / connector-worker precedent);
 * each org's snapshot runs inside its own withTenant transaction.
 */

import { schedule } from "node-cron";

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { riskIntelligenceEnabled } from "../lib/riskIntelligenceFeatureFlag.js";
import { assetRegistryEnabled } from "../lib/assetRegistryFeatureFlag.js";
import { snapshotRiskHistory } from "../lib/riskHistoryStore.js";

export interface RiskHistoryWorkerDeps {
  /** Injectable snapshot date (YYYY-MM-DD); defaults to today (UTC). */
  today?: () => string;
  /** Loop guard for tests / shutdown. */
  shouldContinue?: () => boolean;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Snapshot every organization's risk history for the given day. Never throws —
 * a per-org failure is logged and the sweep continues. Returns the number of
 * orgs snapshotted.
 */
export async function runRiskHistorySnapshot(deps: RiskHistoryWorkerDeps = {}): Promise<number> {
  if (!riskIntelligenceEnabled() || !assetRegistryEnabled()) return 0;
  const date = (deps.today ?? todayUtc)();

  const orgs = await pgElevated.query<{ id: string }>(`SELECT id FROM organizations`);
  let snapshotted = 0;
  for (const org of orgs.rows) {
    if (deps.shouldContinue && !deps.shouldContinue()) break;
    try {
      await withTenant(org.id, () => snapshotRiskHistory(org.id, date));
      snapshotted += 1;
    } catch (err) {
      logger.error(
        { event: "risk_history_snapshot_org_failed", org_id: org.id, date, err },
        "risk-history snapshot failed for one org; continuing"
      );
    }
  }
  if (orgs.rows.length > 0) {
    logger.info(
      { event: "risk_history_snapshot_complete", date, orgs: orgs.rows.length, snapshotted },
      "risk-history daily snapshot complete"
    );
  }
  return snapshotted;
}

let isSnapshotting = false;

/**
 * Register the daily snapshot cron (03:15 UTC — after the brief pipeline, off
 * the top of the hour). Always registered; self-gates inside the run on both
 * flags, so a flag flip takes effect on the next tick with no redeploy. Uses
 * the same `pg`/`pgElevated` proxies as the other workers; the initial import
 * touches nothing until the cron fires.
 */
export function startRiskHistoryWorker(): void {
  // Touch pg so a lint/tree-shake never drops the shared proxy import; the real
  // work happens in the snapshot under withTenant.
  void pg;
  schedule("15 3 * * *", () => {
    if (isSnapshotting) {
      logger.warn({ event: "risk_history_tick_overlap_skipped" }, "risk-history worker: previous snapshot still running");
      return;
    }
    isSnapshotting = true;
    void runRiskHistorySnapshot()
      .catch((err) => logger.error({ event: "risk_history_tick_error", err }, "risk-history worker tick failed"))
      .finally(() => {
        isSnapshotting = false;
      });
  });
  logger.info(
    { event: "risk_history_worker_registered", schedule: "15 3 * * * (daily 03:15 UTC)" },
    "Risk-history snapshot worker registered (gated by SECURELOGIC_RISK_INTELLIGENCE_ENABLED + SECURELOGIC_ASSET_REGISTRY_ENABLED)"
  );
}
