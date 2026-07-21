/**
 * briefCatchup.ts — recover a missed weekly Intelligence Brief send.
 *
 * WHY
 * ---
 * The Brief's sole automated trigger is an in-process node-cron in the engine
 * web service (schedulerRunner, "0 7 * * 2"). One firing opportunity per week,
 * no external retry: a deploy/restart/crash spanning Tuesday 07:00 UTC drops
 * that week's edition silently. This module lets a later boot on the same
 * Tuesday recover the send.
 *
 * WHAT
 * ----
 * On boot, if the catch-up flag is on AND today is the Tuesday send day AND it
 * is past 07:00 UTC AND no brief has been sent yet this week, run the scheduler
 * once (through the shared overlap lock). The window is intentionally the same
 * Tuesday only — it never sends on a different weekday, preserving the B6
 * weekly-Tuesday cadence.
 *
 * SAFETY
 * ------
 * - DARK by default (SECURELOGIC_BRIEF_CATCHUP_ENABLED), operator-owned.
 * - "Delivered this week?" is derived from the newest 'sent' row in
 *   intelligence_brief_sends; if the cron already sent today, catch-up no-ops.
 * - Even if it does run after a partial send, briefEmailSender's idempotency
 *   guard means no subscriber is emailed twice.
 * - Best-effort: never throws into the boot sequence.
 */

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { isBriefSendDay } from "./briefSendWindow.js";
import { briefCatchupEnabled } from "./briefCatchupFeatureFlag.js";
import { runSchedulerGuarded } from "./schedulerRunner.js";

/** The weekly cron fires at 07:00 UTC; catch-up only considers times at/after. */
const SEND_HOUR_UTC = 7;

/**
 * Pure predicate: should a catch-up run given the current time and the most
 * recent successful-send timestamp?
 *
 * True only when ALL hold:
 *   - `now` is the Tuesday send day (isBriefSendDay) — never any other weekday.
 *   - `now` is at/after 07:00 UTC (the cron's fire time has passed).
 *   - no brief has been sent since 00:00 UTC today (i.e. `lastSentAt` is null or
 *     strictly before today's UTC midnight) — if the cron already delivered
 *     today, there is nothing to recover.
 *
 * Exported for unit testing. No I/O.
 */
export function shouldRunCatchup(now: Date, lastSentAt: Date | null): boolean {
  if (!isBriefSendDay(now)) return false;
  if (now.getUTCHours() < SEND_HOUR_UTC) return false;

  const todayMidnightUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0
  );

  if (lastSentAt !== null && lastSentAt.getTime() >= todayMidnightUtc) {
    // A brief was already delivered today (by the cron) — no catch-up needed.
    return false;
  }

  return true;
}

/** Most recent successful Brief send across all orgs, or null if none ever. */
async function fetchLastBriefSentAt(): Promise<Date | null> {
  const result = await pgElevated.query<{ last_sent: Date | null }>(
    `SELECT MAX(sent_at) AS last_sent
     FROM intelligence_brief_sends
     WHERE status = 'sent'`
  );
  const raw = result.rows[0]?.last_sent ?? null;
  return raw === null ? null : new Date(raw);
}

export type CatchupResult = { ran: boolean; reason: string };

/**
 * Run the Brief scheduler once if this week's Tuesday send was missed.
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

  if (!isBriefSendDay(now) || now.getUTCHours() < SEND_HOUR_UTC) {
    // Not the Tuesday post-07:00 window; nothing to recover. Cheap short-circuit
    // before any DB read.
    return { ran: false, reason: "outside_window" };
  }

  let lastSentAt: Date | null;
  try {
    lastSentAt = await fetchLastBriefSentAt();
  } catch (err) {
    logger.error(
      { event: "brief_catchup_query_failed", err },
      "Brief catch-up: failed to query last send — skipping (non-fatal)"
    );
    return { ran: false, reason: "query_failed" };
  }

  if (!shouldRunCatchup(now, lastSentAt)) {
    logger.info(
      { event: "brief_catchup_not_needed", lastSentAt: lastSentAt?.toISOString() ?? null },
      "Brief catch-up: this week's brief already sent — nothing to recover"
    );
    return { ran: false, reason: "already_sent_this_week" };
  }

  logger.warn(
    { event: "brief_catchup_triggered", lastSentAt: lastSentAt?.toISOString() ?? null },
    "Brief catch-up: no brief sent yet this Tuesday — running the scheduler now to recover the missed weekly edition"
  );

  // Runs through the shared overlap lock; idempotency prevents any double-send.
  await runSchedulerGuarded("catchup");

  return { ran: true, reason: "recovered" };
}
