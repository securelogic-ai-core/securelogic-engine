/**
 * actionsMetrics.ts — the ONE presentation-side fallback for the Metric
 * Contract's ACTIVE-actions total.
 *
 * The engine's `GET /api/dashboard/summary` carries `actions.active`
 * (open | in_progress | blocked — blocked work is still work). Older engine
 * payloads omit it, so display code falls back to summing the exact parts the
 * payload does carry. That fallback previously existed as three inline copies
 * (ActionsRing, OpenItemsAging, the Briefing composer) — one definition here so
 * a future change to the ACTIVE predicate cannot drift between surfaces.
 * The predicate itself is owned by the engine (src/api/lib/metricDefinitions.ts);
 * this is only its client-side presentation fallback.
 */

export function activeActionsCount(
  actions:
    | { active?: number; open?: number; in_progress?: number; blocked?: number }
    | null
    | undefined,
): number {
  if (!actions) return 0;
  return (
    actions.active ??
    (actions.open ?? 0) + (actions.in_progress ?? 0) + (actions.blocked ?? 0)
  );
}
