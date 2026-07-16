/**
 * frameworkCoverage.tsx — THE framework coverage bar (walkthrough item 7
 * ruling, 2026-07-15).
 *
 * RULING: the readiness score is satisfied-only (partial earns no credit), so
 * the bar must show the same truth as the number — a solid segment for fully
 * satisfied requirements and a VISUALLY DISTINCT (hatched, lighter) segment
 * for partials. A 0% score beside a hatched half-bar reads as "work exists,
 * none of it complete yet", which is exactly the fact.
 *
 * This component is the single definition of the segmentation; the matching
 * caption ("0 fully satisfied · 3 partial") is formatted once by the ENGINE
 * (src/api/lib/frameworkCoverage.ts) and arrives on the wire as
 * `coverage_caption` — surfaces render it verbatim next to this bar. Neither
 * the wording nor the segmentation may be re-derived per surface.
 */

const TRACK = "rgba(255,255,255,0.08)";

/** Color for a satisfied-only readiness score — same bands as the dashboard's
 *  health-style scoreColor (higher = better), so the coverage bar and every
 *  other 0–100 metric on the page speak one color language. */
function coverageColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#f59e0b";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

export function CoverageBar({
  satisfied,
  partial,
  total,
  heightClass = "h-2",
}: {
  satisfied: number;
  partial: number;
  total: number;
  /** Tailwind height class so the bar can match its host card's scale. */
  heightClass?: string;
}) {
  const score = total === 0 ? 0 : Math.round((satisfied / total) * 100);
  const satisfiedPct = total === 0 ? 0 : Math.min((satisfied / total) * 100, 100);
  const partialPct = total === 0 ? 0 : Math.min((partial / total) * 100, 100 - satisfiedPct);
  const color = coverageColor(score);

  return (
    <div
      className={`${heightClass} rounded-full flex overflow-hidden`}
      style={{ background: TRACK }}
      role="img"
      aria-label={`${satisfied} of ${total} requirements fully satisfied, ${partial} partial`}
    >
      {satisfiedPct > 0 && (
        <div
          data-coverage-segment="satisfied"
          className="h-full"
          style={{ width: `${satisfiedPct}%`, background: color }}
        />
      )}
      {/* Partial work is VISIBLE but visually distinct — hatched and lighter,
          so the bar never implies score credit the number didn't grant. */}
      {partialPct > 0 && (
        <div
          data-coverage-segment="partial"
          className="h-full"
          style={{
            width: `${partialPct}%`,
            background: `repeating-linear-gradient(45deg, ${color}59 0px, ${color}59 3px, ${color}1f 3px, ${color}1f 6px)`,
          }}
        />
      )}
    </div>
  );
}
