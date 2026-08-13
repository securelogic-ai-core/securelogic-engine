/**
 * analysisCoverage.ts — how much of the evidence did automated analysis
 * actually read?
 *
 * The ratified rule this encodes: `deterministic_only` must never imply clean.
 * The stamp is a system OBSERVATION computed from what ran, never a claim
 * accepted from a caller — an operator cannot assert "full" any more than a
 * model can.
 *
 * 'unreadable' analysis rows COUNT as analysed: the system looked, determined a
 * human must read it, and said so. Coverage measures whether analysis ran, not
 * whether it was flattering.
 */

export type AnalysisCoverage = "full" | "partial" | "deterministic_only";

export function computeAnalysisCoverage(args: {
  /** Attached (non-detached, stored) evidence files on the engagement. */
  evidenceCount: number;
  /** evidence_analysis rows for those files. */
  analyzedCount: number;
}): AnalysisCoverage {
  const evidence = Math.max(0, args.evidenceCount);
  const analyzed = Math.max(0, Math.min(args.analyzedCount, evidence));
  // No evidence, or none analysed: only the deterministic pipeline ran.
  if (evidence === 0 || analyzed === 0) return "deterministic_only";
  return analyzed === evidence ? "full" : "partial";
}
