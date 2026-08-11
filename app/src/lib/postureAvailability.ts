/**
 * postureAvailability.ts — the ONE answer to "does this org have a posture
 * score yet?", shared by every surface that makes a claim about posture.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * /getting-started and the Briefing's posture module disagreed, in public, on
 * the same org. The checklist completed step 5 ("Review your security posture —
 * your security posture score is now available") whenever EITHER
 * `overall_score` OR `snapshot_date` was non-null, while the Briefing renders
 * "Insufficient data — no posture snapshot yet." whenever `overall_score` is
 * null, full stop.
 *
 * Those two rules diverge in exactly the state a new tenant lands in. The
 * engine nulls all three posture fields only when NO `posture_snapshots` row
 * exists (`src/api/routes/dashboard.ts`); once a snapshot row exists but has
 * nothing scorable in it, the row carries a `snapshot_date` with a null
 * `overall_score`. A brand-new org therefore got a ✓ on the one step it could
 * not possibly have done, and "1 of 5 complete" before doing anything — while
 * the dashboard it links to correctly said no score existed.
 *
 * THE RULE
 * --------
 * `overall_score` is the only posture truth. A date is not a score: a snapshot
 * can exist and be unscored. Nothing may promote "a snapshot row exists" into
 * "a score exists", and nothing may render a missing score as 0 — 0 is a real,
 * achievable score (`toDisplayScore` is HEALTH-style, higher = better), so
 * "missing" and "zero" must stay distinguishable end to end.
 *
 * The three states are kept apart because they need different words:
 *   - `available`   — a score exists; render it from the real value.
 *   - `pending`     — no score yet; say what still has to happen.
 *   - `unavailable` — we could not read posture at all, so we do not know.
 *                     `getDashboardSummary` returns null on a failed/!ok
 *                     engine read, and collapsing that into "no posture yet"
 *                     would state as fact something we never learned.
 *
 * Dependency-free and pure, on purpose: it is imported from a Server Component
 * (/getting-started) and from the Briefing composer alike, and mirrors the
 * pattern set by postureTrend.ts — one function so two surfaces cannot drift.
 */

/** The posture block off a dashboard summary. Only the score is load-bearing. */
export type PostureLike = {
  overall_score: number | null;
} | null | undefined;

/** A dashboard summary, or `null` when the engine read failed. */
export type PostureSummaryLike = {
  posture?: PostureLike;
} | null | undefined;

export type PostureAvailability = "available" | "pending" | "unavailable";

/**
 * The posture score, or null when there isn't one.
 *
 * This is the single definition every surface reads through. `?? null`
 * normalises a missing/undefined block to the same "no score" as an explicit
 * null, and deliberately preserves 0.
 */
export function postureScoreOf(posture: PostureLike): number | null {
  return posture?.overall_score ?? null;
}

/**
 * Which of the three posture states this org is in.
 *
 * `summary === null` means the read itself failed — that is `unavailable`, not
 * `pending`, because we learned nothing about whether a score exists.
 */
export function getPostureAvailability(
  summary: PostureSummaryLike,
): PostureAvailability {
  if (summary === null || summary === undefined) return "unavailable";
  return postureScoreOf(summary.posture) === null ? "pending" : "available";
}

/** True only when a real score exists. The completion signal for onboarding. */
export function isPostureAvailable(summary: PostureSummaryLike): boolean {
  return getPostureAvailability(summary) === "available";
}
