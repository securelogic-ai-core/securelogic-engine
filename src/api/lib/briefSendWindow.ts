/**
 * briefSendWindow.ts — weekday gate for Intelligence Brief email delivery.
 *
 * The Brief scheduler generates briefs Mon-Fri (cron "0 7 * * 1-5"), and email
 * delivery is restricted to weekdays as well. This pure predicate is the
 * single source of truth for "is today an email-send day", used by
 * briefScheduler.runScheduler() to guard the sendBrief() step.
 *
 * It is intentionally decoupled from the cron so it ALSO protects the manual
 * trigger (POST /api/admin/briefs/run-scheduler), which calls runScheduler()
 * directly and would otherwise send on a weekend if invoked then.
 *
 * Timezone: UTC, to match the cron's "{ timezone: 'UTC' }" basis. The 7:00 AM
 * UTC fire time keeps Mon-Fri aligned with the business week for the relevant
 * audience; if a business-timezone window is ever required, change it here
 * (one place) rather than at every call site.
 */

/** Day-of-week numbers (getUTCDay): Sunday = 0, Saturday = 6. */
const SUNDAY = 0;
const SATURDAY = 6;

/**
 * Returns true when `date` (interpreted in UTC) falls on a weekday (Mon-Fri),
 * i.e. an Intelligence Brief email-send day. Saturday and Sunday return false.
 */
export function isBriefSendDay(date: Date): boolean {
  const dow = date.getUTCDay();
  return dow !== SATURDAY && dow !== SUNDAY;
}
