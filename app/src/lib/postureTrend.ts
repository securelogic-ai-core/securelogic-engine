/**
 * postureTrend.ts — pure posture-delta math (EG2 Tier 2 slice 12,
 * Executive Awareness).
 *
 * "Are we improving?" was not answerable anywhere: /posture drew one line and
 * the Briefing showed a static number. This helper turns the snapshot history
 * the API already returns into an honest period delta:
 *
 *   - the BASELINE is the snapshot closest to (latest - windowDays), accepted
 *     only within a tolerance (±25% of the window) — a 90-day delta computed
 *     against a 20-day-old baseline would be a lie wearing a label;
 *   - null when there is no latest score, no acceptable baseline, or the
 *     baseline has a null score — "insufficient history" is a rendered state,
 *     never a fabricated 0%.
 *
 * Dependency-free and unit-tested; both /posture and the Briefing module read
 * deltas through this one function so the two surfaces can never disagree.
 */

export type PostureSnapshotLike = {
  snapshot_date: string;
  overall_score: number | null;
};

export type PostureDelta = {
  windowDays: number;
  current: number;
  baseline: number;
  baselineDate: string;
  /** Score points gained (positive = improving; the series is HEALTH-style). */
  points: number;
  /** Percent change vs the baseline, one decimal. Null when baseline is 0. */
  pct: number | null;
};

export function postureDelta(
  snapshots: readonly PostureSnapshotLike[],
  windowDays: number
): PostureDelta | null {
  if (windowDays <= 0) return null;
  const scored = snapshots
    .filter((s) => s.overall_score !== null)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  if (scored.length < 2) return null;

  const latest = scored[scored.length - 1]!;
  const latestMs = Date.parse(latest.snapshot_date);
  const targetMs = latestMs - windowDays * 24 * 60 * 60 * 1000;
  const toleranceMs = windowDays * 0.25 * 24 * 60 * 60 * 1000;

  let baseline: PostureSnapshotLike | null = null;
  let bestDistance = Infinity;
  for (const s of scored) {
    if (s === latest) continue;
    const distance = Math.abs(Date.parse(s.snapshot_date) - targetMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      baseline = s;
    }
  }
  if (!baseline || bestDistance > toleranceMs) return null;

  const current = latest.overall_score!;
  const base = baseline.overall_score!;
  const points = current - base;
  return {
    windowDays,
    current,
    baseline: base,
    baselineDate: baseline.snapshot_date,
    points,
    pct: base === 0 ? null : Math.round((points / base) * 1000) / 10,
  };
}

/** "+9 (+15.0%)" / "−4 (−6.2%)" / "+3" when pct is unavailable. */
export function formatPostureDelta(d: PostureDelta): string {
  const sign = d.points > 0 ? "+" : d.points < 0 ? "−" : "±";
  const points = `${sign}${Math.abs(d.points)}`;
  if (d.pct === null) return points;
  const pctSign = d.pct > 0 ? "+" : d.pct < 0 ? "−" : "±";
  return `${points} (${pctSign}${Math.abs(d.pct)}%)`;
}
