/**
 * Brief staleness — the single shared rule for every "Latest Brief" surface.
 *
 * The brief cadence is weekly (Tuesday 07:00 UTC — schedulerRunner cron
 * "0 7 * * 2"), so one full cadence window plus a day of publish slack is the
 * honest limit: a brief more than 8 days old cannot be the current cycle's
 * brief. Old intelligence must never silently present as current — a stale
 * latest brief carries an explicit age warning (walkthrough item 4), on the
 * canonical Intelligence Brief card and on the legacy newsletter-issue
 * fallback card alike. One rule, one label, everywhere.
 */
export const STALE_AFTER_DAYS = 8;

export function briefAgeDays(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

export function isBriefStale(dateStr: string): boolean {
  return briefAgeDays(dateStr) > STALE_AFTER_DAYS;
}

export function staleAgeLabel(ageDays: number): string {
  const weeks = Math.floor(ageDays / 7);
  const age = weeks >= 2 ? `${weeks} weeks` : `${ageDays} days`;
  return `This brief is ${age} old — briefs are published weekly. A newer brief has not been generated yet.`;
}
