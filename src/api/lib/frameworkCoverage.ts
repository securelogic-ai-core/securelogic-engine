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
 * NOT covered here: the assessment-response readiness in frameworks.ts /
 * requirements.ts (`(pass + partial*0.5)/total` over questionnaire responses).
 * That is a different metric family on a different data source; whether it
 * should also be satisfied-only is an open design question for Simmee — do
 * not silently rewire it through this module.
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
