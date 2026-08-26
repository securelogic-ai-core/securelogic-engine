/**
 * orphanBriefReaper.ts — closes out Intelligence Briefs stranded in
 * 'generating'.
 *
 * THE DEFECT THIS CLOSES
 * ----------------------
 * `generateAndStoreBrief` commits the brief row in 'generating' state (Phase 1)
 * and then runs the Claude enrichment/synthesis calls OUTSIDE any transaction
 * (Phase 2), precisely so a tenant connection is not pinned across minutes of
 * provider latency. Both in-code failure paths mark the row 'failed'. What no
 * path covers is the process simply dying mid-Phase-2 — a deploy SIGTERM during
 * the multi-hour weekly run. The row then stays 'generating' forever:
 *   - the scheduler's idempotency skip set requires status = 'published', so
 *     the next run generates a NEW brief and never revisits the orphan;
 *   - the staleness sweep also counts only 'published', so it alerts correctly
 *     but never cleans up;
 *   - nothing else in the system transitions the row.
 * The result is permanent 'generating' rows accumulating one per interrupted
 * run, misrepresenting the brief pipeline's state to anyone reading the table.
 *
 * DESIGN
 * ------
 * A single bounded UPDATE: 'generating' rows untouched for longer than any
 * legitimate generation can take become 'failed' — the same terminal state the
 * in-code error paths use, so downstream consumers need no new vocabulary.
 * Marking 'failed' (not deleting) preserves the evidence that a run was
 * interrupted, and 'failed' is already an allowed value of the status CHECK
 * constraint, so this needs no migration.
 *
 * The threshold is deliberately generous: Phase 2 is minutes (bounded
 * enrichment fan-out plus two synthesis calls), so hours of silence means the
 * process is gone, not slow. Too tight a threshold would race a live run and
 * mark a healthy brief failed — the one outcome worse than the orphan.
 *
 * Cross-org sweep by design → pgElevated. Read-modify is confined to the
 * status column; no customer content is touched.
 *
 * Ops brake: SECURELOGIC_BRIEF_REAPER_DISABLED=true skips every tick.
 */

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const INTERVAL_MS = 60 * 60 * 1000; // hourly
/** Silence longer than this means the generating process is gone, not slow. */
const STUCK_AFTER_HOURS = 3;
const BATCH_SIZE = 100;

export function briefReaperDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_BRIEF_REAPER_DISABLED"] === "true";
}

export type OrphanBriefReapResult = {
  reaped: number;
  brief_ids: string[];
};

export async function runOrphanBriefReap(): Promise<OrphanBriefReapResult> {
  if (briefReaperDisabled()) {
    return { reaped: 0, brief_ids: [] };
  }

  const result = await pgElevated.query<{ id: string; organization_id: string }>(
    `UPDATE intelligence_briefs
        SET status = 'failed', updated_at = NOW()
      WHERE id IN (
        SELECT id
          FROM intelligence_briefs
         WHERE status = 'generating'
           AND updated_at < NOW() - make_interval(hours => $1)
         ORDER BY updated_at ASC
         LIMIT $2
      )
      RETURNING id, organization_id`,
    [STUCK_AFTER_HOURS, BATCH_SIZE]
  );

  const rows = result.rows;
  if (rows.length > 0) {
    logger.warn(
      {
        event: "orphan_brief_reaped",
        reaped: rows.length,
        brief_ids: rows.map((r) => r.id),
        organization_ids: [...new Set(rows.map((r) => r.organization_id))],
        stuck_after_hours: STUCK_AFTER_HOURS
      },
      "Marked stranded 'generating' Intelligence Brief(s) as failed — their generating process died mid-run"
    );
  }

  return { reaped: rows.length, brief_ids: rows.map((r) => r.id) };
}

export function startOrphanBriefReaper(): void {
  if (briefReaperDisabled()) {
    logger.info(
      { event: "orphan_brief_reaper_disabled" },
      "Orphan-brief reaper: SECURELOGIC_BRIEF_REAPER_DISABLED — not starting"
    );
    return;
  }

  const tick = (): void => {
    runOrphanBriefReap().catch((err) =>
      logger.error({ event: "orphan_brief_reap_error", err }, "Orphan-brief reap failed")
    );
  };

  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref();

  logger.info(
    { event: "orphan_brief_reaper_started", interval_ms: INTERVAL_MS },
    "Orphan-brief reaper started"
  );
}
