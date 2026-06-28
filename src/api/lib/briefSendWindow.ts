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

/**
 * Returns true when `date` (interpreted in UTC) falls on Tuesday, i.e. the
 * weekly Intelligence Brief email-send day. Every other day returns false.
 */
export function isBriefSendDay(date: Date): boolean {
  return date.getUTCDay() === TUESDAY;
}
