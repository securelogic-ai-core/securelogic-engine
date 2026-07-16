/**
 * postureDisplay.ts — THE canonical posture presentation mapper
 * (walkthrough items 1+2 ruling, 2026-07-15).
 *
 * RULING: customers see posture as HEALTH-style — higher = better — on every
 * surface. The ENGINE stays risk-style internally (DomainRiskAggregationEngineV2,
 * posture_snapshots.overall_score, domain_scores.score are all higher = worse and
 * are NOT touched); the inversion happens exactly once, here, at the API/display
 * boundary. No surface may convert ad-hoc: routes, reports, emails and the Ask
 * context all pass their DB risk values through this module before emitting.
 *
 * display = 100 − risk (clamped to 0–100). Severity labels are NOT remapped —
 * a Critical posture is still Critical; under health framing the label now sits
 * beside a LOW number (risk 96 → display 4/100 + "Critical"), which is coherent,
 * where "96 + Critical" read as a contradiction (the July-15 walkthrough item 1).
 *
 * The trend series converts through the same function so history stays coherent
 * with the headline. The cutover is annotated in the release notes alongside the
 * posture-population discontinuity.
 */

/** Invert a risk-style score (higher = worse) to display health (higher = better). */
export function toDisplayScore(riskScore: number | null | undefined): number | null {
  if (riskScore === null || riskScore === undefined) return null;
  const n = Number(riskScore);
  if (Number.isNaN(n)) return null;
  return Math.round(100 - Math.min(100, Math.max(0, n)));
}

/** A posture snapshot row as read from the DB (risk-style). */
export interface PostureScoreFields {
  overall_score: number | null;
  overall_severity: string | null;
}

/** Convert the snapshot headline fields. Severity label passes through. */
export function toDisplayPosture<T extends PostureScoreFields>(row: T): T {
  return { ...row, overall_score: toDisplayScore(row.overall_score) };
}

/** Convert one domain_scores row (risk-style `score`). Severity passes through. */
export function toDisplayDomain<T extends { score: number | null }>(row: T): T {
  return { ...row, score: toDisplayScore(row.score) };
}

/** Convert a trend series of snapshot rows through the SAME mapping. */
export function toDisplayTrend<T extends { overall_score: number | null }>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, overall_score: toDisplayScore(r.overall_score) }));
}
