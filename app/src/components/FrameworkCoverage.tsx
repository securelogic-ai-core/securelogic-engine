/**
 * FrameworkCoverage — THE one place the framework coverage rule is defined
 * (walkthrough item 7 ruling, 2026-07-15).
 *
 * The rule:
 *   - The SCORE stays satisfied-only (round(satisfied / total × 100)) — strict
 *     and audit-defensible: a partially-implemented requirement is not satisfied.
 *     The engine's readiness_score is unchanged; this module never recomputes it.
 *   - Every surface CAPTIONS the number ("0 fully satisfied · 3 partial") so a
 *     zero never reads as zero-effort.
 *   - Every progress bar renders partials as a VISUALLY DISTINCT segment
 *     (solid = satisfied, hatched = partial) — the bar shows the same truth as
 *     the number, never a different one.
 *
 * Consumers: ComplianceCoverage tile, FrameworkReadinessWidget, FrameworkGaps
 * (dashboard) and the /frameworks pages. Defining caption + segmentation here is
 * what keeps them from drifting per-surface — the walkthrough found three
 * different color thresholds and no caption at all.
 */

/** Satisfied-only percent — mirrors the engine's readiness_score formula. */
export function coveragePct(satisfied: number, total: number): number {
  return total > 0 ? Math.round((satisfied / total) * 100) : 0;
}

/**
 * The canonical caption. Always names satisfied and partial (even at zero — the
 * walkthrough defect was "0%" with the 3 partials visible only as an orphan
 * label); unmapped appears only when present.
 */
export function coverageCaption(
  satisfied: number,
  partial: number,
  unmapped?: number,
): string {
  const parts = [
    `${satisfied} fully satisfied`,
    `${partial} partial`,
    ...(unmapped && unmapped > 0 ? [`${unmapped} unmapped`] : []),
  ];
  return parts.join(" · ");
}

/** The one score color band (posture-style, higher = better). */
export function coverageColor(pct: number): string {
  if (pct >= 80) return "#22c55e";
  if (pct >= 60) return "#f59e0b";
  if (pct >= 40) return "#f97316";
  return "#ef4444";
}

/** Amber hatch for the partial segment — visually distinct from any solid fill. */
const PARTIAL_HATCH =
  "repeating-linear-gradient(45deg, rgba(245,158,11,0.55) 0px, rgba(245,158,11,0.55) 3px, rgba(245,158,11,0.18) 3px, rgba(245,158,11,0.18) 6px)";

/**
 * Two-segment coverage bar: solid = satisfied share, hatched = partial share.
 * The solid segment's width IS the reported score; the hatch adds visible
 * effort without adding score.
 */
export function CoverageBar({
  satisfied,
  partial,
  total,
  heightClass = "h-1.5",
}: {
  satisfied: number;
  partial: number;
  total: number;
  heightClass?: string;
}) {
  const satisfiedPctRaw = total > 0 ? (satisfied / total) * 100 : 0;
  const partialPctRaw = total > 0 ? (partial / total) * 100 : 0;
  // Clamp so the two segments can never overflow the track on odd inputs.
  const satisfiedPct = Math.min(100, Math.max(0, satisfiedPctRaw));
  const partialPct = Math.min(100 - satisfiedPct, Math.max(0, partialPctRaw));
  const color = coverageColor(coveragePct(satisfied, total));
  return (
    <div
      className={`flex-1 rounded-full overflow-hidden flex ${heightClass}`}
      style={{ background: "rgba(255,255,255,0.08)" }}
      role="img"
      aria-label={coverageCaption(satisfied, partial)}
    >
      {satisfiedPct > 0 && (
        <div className={heightClass} style={{ width: `${satisfiedPct}%`, background: color }} />
      )}
      {partialPct > 0 && (
        <div
          className={heightClass}
          data-segment="partial"
          style={{ width: `${partialPct}%`, background: PARTIAL_HATCH }}
        />
      )}
    </div>
  );
}
