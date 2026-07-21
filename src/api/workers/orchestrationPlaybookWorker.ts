/**
 * orchestrationPlaybookWorker.ts — ERIP E6b: the scheduled playbook worker.
 * Instantiates due, enabled, scheduled playbooks — each run creates PROPOSALS
 * (status 'proposed') that still require human approval (ERIP-AD-24). No
 * auto-execution: the scheduler only proposes.
 *
 * Registered always; each tick self-gates on the Autonomous-Operations flag —
 * zero DB access while off. Cross-org due-scan on the elevated channel; each
 * playbook instantiated inside its org's withTenant transaction; never throws.
 */

import { schedule } from "node-cron";

import { pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { autonomousOperationsEnabled } from "../lib/autonomousOperationsFeatureFlag.js";
import { getPlaybook, runPlaybook } from "../lib/orchestrationPlaybookStore.js";

export interface PlaybookWorkerDeps {
  shouldContinue?: () => boolean;
}

/** Bounded per-tick fan-out. */
export const MAX_PLAYBOOK_RUNS_PER_TICK = 100;

interface DueRow {
  organization_id: string;
  id: string;
}

/**
 * Instantiate every due scheduled playbook. Returns the number instantiated.
 * Never throws — a per-playbook failure is logged and the sweep continues.
 */
export async function runDuePlaybooks(deps: PlaybookWorkerDeps = {}): Promise<number> {
  if (!autonomousOperationsEnabled()) return 0;

  const due = await pgElevated.query<DueRow>(
    `SELECT organization_id, id FROM orchestration_playbooks
      WHERE enabled AND schedule_interval_minutes IS NOT NULL
        AND (next_run_at IS NULL OR next_run_at <= now())
      ORDER BY next_run_at ASC NULLS FIRST
      LIMIT ${MAX_PLAYBOOK_RUNS_PER_TICK}`
  );

  let ran = 0;
  for (const row of due.rows) {
    if (deps.shouldContinue && !deps.shouldContinue()) break;
    try {
      const created = await withTenant(row.organization_id, async () => {
        const pb = await getPlaybook(row.organization_id, row.id);
        if (!pb) return 0;
        const res = await runPlaybook(row.organization_id, pb, null);
        return res.proposal_ids.length;
      });
      if (created > 0) ran += 1;
    } catch (err) {
      logger.error(
        { event: "playbook_run_failed", org_id: row.organization_id, playbook_id: row.id, err },
        "scheduled playbook instantiation failed; continuing"
      );
    }
  }
  if (due.rows.length > 0) {
    logger.info({ event: "playbook_scheduler_complete", due: due.rows.length, ran }, "playbook scheduler complete");
  }
  return ran;
}

let isRunning = false;

/**
 * Register the playbook scheduler cron (every 5 minutes). Always registered;
 * self-gates inside the run on the Autonomous-Operations flag.
 */
export function startOrchestrationPlaybookWorker(): void {
  schedule("*/5 * * * *", () => {
    if (isRunning) {
      logger.warn({ event: "playbook_tick_overlap_skipped" }, "playbook worker: previous run still going");
      return;
    }
    isRunning = true;
    void runDuePlaybooks()
      .catch((err) => logger.error({ event: "playbook_tick_error", err }, "playbook worker tick failed"))
      .finally(() => {
        isRunning = false;
      });
  });
  logger.info(
    { event: "orchestration_playbook_worker_registered", schedule: "*/5 * * * * (every 5 min)" },
    "Orchestration playbook worker registered (gated by SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED)"
  );
}
