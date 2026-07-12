/**
 * ExecutiveKpiCards.tsx — the KPI scorecard row. Server-renderable; consumes
 * GET /api/risk/kpis. Risk metrics color an increase RED (worse); asset growth
 * is neutral.
 *
 * Every card that counts a POPULATION drills through to the view that reproduces it,
 * scoped to the dimension on screen (see kpiDestination). Before this, the executive
 * dashboard had no drill-through at all: its only anchor was the CSV export, so every
 * number a board member could see was a dead end.
 *
 * The two cards that report SCORES — peak and average risk — are deliberately not links.
 * A score has no list behind it, and sending a customer to a list of assets from it would
 * be inventing a relationship the number does not have.
 */

import Link from "next/link";
import { formatDelta, round1, kpiDestination, type KpiCard } from "@/lib/executiveRisk";

const TONE_COLOR: Record<string, string> = { good: "#86efac", bad: "#fca5a5", neutral: "#94a3b8" };

export function ExecutiveKpiCards({
  kpis,
  windowDays,
  dimension,
  asOf,
}: {
  kpis: KpiCard[];
  windowDays: number;
  /** The view on screen — it travels with the drill-through so the destination is scoped. */
  dimension: string;
  /** The snapshot these figures come from. Disclosed, because the destination is LIVE. */
  asOf?: string | null;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => {
          const d = formatDelta(k.key, k.change);
          const href = kpiDestination(k.key, dimension);

          const body = (
            <>
              <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "#64748b" }}>
                {k.label}
              </p>
              <p className="mt-1 text-2xl font-bold" style={{ color: "#f1f5f9" }}>
                {round1(k.value)}
              </p>
              <p className="mt-1 text-xs font-medium" style={{ color: TONE_COLOR[d.tone] }}>
                {d.arrow} {d.text}
                <span style={{ color: "#475569" }}> · {windowDays}d</span>
              </p>
            </>
          );

          const className = "block rounded-xl border border-brand-line bg-brand-surface p-4";

          // A card with no faithful destination stays a card. It does not become a link
          // to somewhere merely adjacent.
          return href ? (
            <Link
              key={k.key}
              href={href}
              className={`${className} transition-opacity hover:opacity-80`}
            >
              {body}
            </Link>
          ) : (
            <div key={k.key} className={className}>
              {body}
            </div>
          );
        })}
      </div>

      {asOf && (
        // The figures above are a daily SNAPSHOT; the registry they open is live. Saying
        // so is the difference between a number the customer can trust and one that looks
        // broken the first time it disagrees with its own destination by a day's drift.
        <p className="mt-2 text-xs" style={{ color: "#475569" }}>
          As of the {asOf} snapshot. Opening a figure shows the live registry, which may
          have moved since.
        </p>
      )}
    </div>
  );
}
