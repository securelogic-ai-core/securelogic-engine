/**
 * frameworkCoverage.ts — THE framework coverage rule (walkthrough item 7
 * ruling, 2026-07-15).
 *
 * RULING: readiness keeps satisfied-only math — a partially-covered
 * requirement earns NO score credit — and every surface that shows the score
 * must also show the explicit caption ("0 fully satisfied · 3 partial") so a
 * 0% score beside visible work-in-progress never reads as a contradiction.
 *
 * This module is the single definition of both. Before it, the identical
 * formula lived in frameworkReadiness.ts, auditPackage.ts, and gapReport.ts,
 * and each surface phrased the breakdown its own way (some dropped the
 * "0 fully satisfied" part entirely — the walkthrough defect). Routes emit
 * `coverage_caption` on the wire so app surfaces render the words verbatim
 * and cannot drift.
 *
 * O-5 ruling (Simmee, 2026-07-16): readiness means "how much of this
 * framework is actually implemented and satisfied" — satisfied control
 * mappings ONLY. Assessment responses, questionnaires, and evidence
 * collection are PROGRESS, never readiness, and must never contribute to any
 * readiness score. The old assessment-response formula in frameworks.ts /
 * requirements.ts (`(pass + partial*0.5)/total`) is gone; those endpoints now
 * emit `progress_pct` from assessmentProgress() below, labeled
 * "Assessment Progress" on every surface.
 */

export interface CoverageCounts {
  satisfied: number;
  partial: number;
  unmapped: number;
}

/**
 * Satisfied-only readiness score, 0–100 integer.
 * Partial coverage earns no credit — by ruling, not by accident.
 */
export function readinessScore(satisfied: number, total: number): number {
  return total === 0 ? 0 : Math.round((satisfied / total) * 100);
}

/**
 * The explicit coverage caption. "Fully satisfied" is ALWAYS present — even
 * (especially) when it is 0, because "0 fully satisfied · 3 partial" is the
 * exact sentence that explains a 0% score beside visible work. Partial and
 * unmapped appear whenever they are non-zero.
 */
export function coverageCaption(counts: CoverageCounts): string {
  const parts = [`${counts.satisfied} fully satisfied`];
  if (counts.partial > 0) parts.push(`${counts.partial} partial`);
  if (counts.unmapped > 0) parts.push(`${counts.unmapped} unmapped`);
  return parts.join(" · ");
}

/**
 * Assessment progress, 0–100 integer: the share of requirements with a
 * completed response (pass, partial, or fail — completion counts, quality
 * does not). O-5 ruling: this is a separate metric from readiness. It answers
 * "how much have we assessed?", never "how much is implemented?", and must
 * never feed a readiness score.
 */
export function assessmentProgress(assessed: number, total: number): number {
  return total === 0 ? 0 : Math.round((assessed / total) * 100);
}
