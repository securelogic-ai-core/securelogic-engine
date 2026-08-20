/**
 * briefSendWindow.ts — weekly send-day gate for Intelligence Brief email delivery.
 *
 * The Brief scheduler generates and sends the brief once per week on Tuesday
 * (cron "0 7 * * 2"). This pure predicate is the single source of truth for
 * "is today an email-send day", used by briefScheduler.runScheduler() to guard
 * the sendBrief() step.
 *
 * It is intentionally decoupled from the cron so it ALSO protects the manual
 * trigger (POST /api/admin/briefs/run-scheduler), which calls runScheduler()
 * directly and would otherwise send on a non-send day if invoked then.
 *
 * Timezone: UTC, to match the cron's "{ timezone: 'UTC' }" basis. The 7:00 AM
 * UTC fire time keeps the weekly Tuesday edition aligned with the business week
 * for the relevant audience; if a business-timezone window is ever required,
 * change it here (one place) rather than at every call site.
 */

/** Day-of-week numbers (getUTCDay): Sunday = 0 … Tuesday = 2 … Saturday = 6. */
const TUESDAY = 2;

/** The weekly cron's fire hour ("0 7 * * 2" — Tuesday 07:00 UTC). */
export const BRIEF_SEND_HOUR_UTC = 7;

/**
 * Returns true when `date` (interpreted in UTC) falls on Tuesday, i.e. the
 * weekly Intelligence Brief email-send day. Every other day returns false.
 */
export function isBriefSendDay(date: Date): boolean {
  return date.getUTCDay() === TUESDAY;
}

/**
 * The start of the weekly edition window containing `now`: the most recent
 * Tuesday 07:00:00 UTC at or before `now`. A published brief with
 * generated_at >= this instant IS the current week's edition for its org;
 * an eligible org without one has missed the week's run.
 *
 * This is the shared idempotency boundary for the scheduler's per-org skip
 * (briefScheduler) and the catch-up's completeness check (briefCatchup) —
 * both must agree on "which edition is current" or a rerun could duplicate
 * or permanently skip an edition. On Tuesday BEFORE 07:00 UTC the current
 * edition is still LAST week's (the cron has not fired yet).
 */
export function currentBriefWeekStart(now: Date): Date {
  const weekStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    BRIEF_SEND_HOUR_UTC,
    0,
    0,
    0
  ));
  let daysBack = (now.getUTCDay() - TUESDAY + 7) % 7;
  if (daysBack === 0 && now.getTime() < weekStart.getTime()) {
    daysBack = 7;
  }
  weekStart.setUTCDate(weekStart.getUTCDate() - daysBack);
  return weekStart;
}
