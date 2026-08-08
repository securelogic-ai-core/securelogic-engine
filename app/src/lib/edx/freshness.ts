/**
 * freshness.ts — EDX date-provenance helpers (pattern EDX-8).
 *
 * First production consumer: the Intelligence Brief window-contradiction
 * guard (W0). A brief masthead promises a coverage window; each item may
 * carry the date its source asserts (`signal_published_at`). When the source
 * date predates the window by more than a grace period, the reader must be
 * TOLD — today they are left to do the arithmetic between "Reported Mar 1,
 * 2010" and a "Jul 26 – Aug 2" masthead themselves (staging evidence:
 * CVE-2002-0367 shipped inside a 2026 brief).
 *
 * Contract notes:
 * - Pure and clock-free: both inputs come from stored data, never Date.now().
 * - Absent/invalid dates return null — a contradiction is only ever asserted
 *   from two REAL dates, mirroring the pinned "never inferred, never
 *   substituted" rule in brief.recency.display.test.tsx.
 * - All arithmetic is UTC-day based, consistent with formatDateOnlyUTC, so
 *   the note can never disagree with the rendered dates by a timezone day.
 */

/**
 * How far before the window start a source date may sit without triggering
 * the contradiction note. Briefs legitimately carry items reported shortly
 * before the window opens (late-breaking items from the prior week, KEV
 * entries added days after vendor disclosure). A month of slack keeps the
 * note reserved for genuine falsehoods rather than editorial judgment calls.
 */
export const WINDOW_CONTRADICTION_GRACE_DAYS = 30;

const MS_PER_DAY = 86_400_000;

function parseUtcMs(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whole UTC days from `dateStr` to `referenceStr` (positive when `dateStr`
 * is earlier). Null when either date is absent or unparseable.
 */
export function daysBefore(
  dateStr: string | null | undefined,
  referenceStr: string | null | undefined
): number | null {
  const date = parseUtcMs(dateStr);
  const reference = parseUtcMs(referenceStr);
  if (date === null || reference === null) return null;
  return Math.floor((reference - date) / MS_PER_DAY);
}

/**
 * Human age label for a day count: "45 days", "10 months", "16 years".
 * Chooses the largest unit with a value of at least 1 (years), falling back
 * to months at 60+ days so "1 month" never rounds a few weeks up.
 */
export function ageLabel(days: number): string {
  const years = Math.floor(days / 365);
  if (years >= 1) return `${years} year${years === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30);
  if (months >= 2) return `${months} months`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * The window-contradiction decision: given an item's source-asserted date and
 * the coverage window's start, return the age label to disclose ("16 years")
 * when the source date predates the window by more than `graceDays` — else
 * null (no note; nothing is asserted from absence).
 */
export function windowContradictionAge(
  publishedAt: string | null | undefined,
  windowStart: string | null | undefined,
  graceDays: number = WINDOW_CONTRADICTION_GRACE_DAYS
): string | null {
  const days = daysBefore(publishedAt, windowStart);
  if (days === null || days <= graceDays) return null;
  return ageLabel(days);
}
