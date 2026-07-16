/**
 * dates.ts — date-only formatting for DATE-typed fields (walkthrough item 2b).
 *
 * posture_snapshots.snapshot_date is a Postgres DATE ("2026-07-15").
 * `new Date("2026-07-15")` parses as UTC midnight, so formatting it WITHOUT a
 * timeZone renders the previous day in any negative-UTC zone — the dashboard
 * said "as of Jul 14" while the trend chart (which forces UTC) said "first
 * snapshot Jul 15" for the SAME row. Every date-only field formats through
 * here, pinned to UTC, so two surfaces can never disagree about one date.
 */

export function formatDateOnlyUTC(
  dateStr: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
