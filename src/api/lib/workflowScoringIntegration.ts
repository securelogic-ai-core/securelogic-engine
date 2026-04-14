/**
 * workflowScoringIntegration.ts — Pure integration helpers connecting
 * workflow outputs to the posture scoring engine.
 *
 * No I/O. All functions are pure and fully unit-testable.
 *
 * PURPOSE
 * -------
 * The scoring engine (DomainRiskAggregationEngineV2 + OverallRiskAggregationEngineV2)
 * operates on a flat array of signal objects. Every workflow in the platform
 * produces signals that feed the engine:
 *
 *   Findings (source_type):
 *     assessment         — direct assessment findings
 *     control_test       — control assessment workflow
 *     vendor_review      — vendor assessment workflow
 *     vendor_cycle_review — vendor review workflow
 *     ai_review          — governance review workflow (point-in-time)
 *     ai_governance_review — AI governance assessment workflow
 *     obligation_review  — obligation assessment workflow
 *     dependency_review  — dependency review workflow
 *     signal             — signal-sourced findings
 *     manual             — manually entered findings
 *     risk               — findings derived from risk register entries
 *
 *   Risks (direct from risk register):
 *     open risks with risk_rating → mapped to finding-shape signals
 *
 * This module provides functions to:
 *   1. buildWorkflowSignalBreakdown — attribute each signal to its workflow source
 *   2. buildScoringRationaleExtension — produce the rationale extension for the
 *      posture snapshot's computation_rationale field
 *
 * TREATMENT TRANSPARENCY
 * ----------------------
 * Open risks that have at least one active treatment (risk_treatments.status
 * IN ('not_started', 'in_progress')) are still included in scoring — the risk
 * is open until its treatment reaches a terminal state (mitigated/accepted/
 * transferred), at which point the risk.status is updated and the risk drops
 * out of the posture signal set. However, the presence of active treatments
 * is surfaced in computation_rationale so that downstream consumers can see
 * how many open risks are actively being addressed.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Source-type breakdown of open findings feeding the scoring engine.
 * Keys are the canonical source_type values from the findings table.
 */
export type FindingSignalBreakdown = Record<string, number>;

/**
 * Full workflow signal breakdown returned by buildWorkflowSignalBreakdown.
 * Included verbatim in computation_rationale for traceability.
 */
export type WorkflowSignalBreakdown = {
  /** Total number of signals fed to the scoring engine (findings + risk signals) */
  total_signals: number;
  /** How many signals originated from the findings table */
  finding_signals: number;
  /** How many signals originated from the risk register (open risks) */
  risk_signals: number;
  /** Breakdown of finding signals by source_type (workflow origin) */
  by_source_type: FindingSignalBreakdown;
  /**
   * Number of open risks that have at least one active treatment
   * (treatment.status IN ('not_started', 'in_progress')).
   * These risks still contribute to scoring — the risk is open — but
   * they are being actively managed, which is noted here for transparency.
   */
  risks_with_active_treatment: number;
};

// ---------------------------------------------------------------------------
// buildWorkflowSignalBreakdown
// ---------------------------------------------------------------------------

/**
 * Build a structured breakdown of all signals currently feeding the
 * scoring engine, attributed by workflow source.
 *
 * @param findingSourceTypeRows  Rows from:
 *   SELECT source_type, COUNT(*)::text AS count
 *   FROM findings
 *   WHERE organization_id = $1 AND status = 'open'
 *   GROUP BY source_type
 *
 * @param riskSignalCount         Number of open risk-register entries used
 *                                as scoring signals (already fetched by caller).
 *
 * @param risksWithActiveTreatment  Number of those open risks that have at
 *                                  least one active treatment in progress.
 */
export function buildWorkflowSignalBreakdown(
  findingSourceTypeRows: ReadonlyArray<{ source_type: string; count: string }>,
  riskSignalCount: number,
  risksWithActiveTreatment: number
): WorkflowSignalBreakdown {
  const by_source_type: FindingSignalBreakdown = {};
  let finding_signals = 0;

  for (const row of findingSourceTypeRows) {
    const n = parseInt(row.count, 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    by_source_type[row.source_type] = (by_source_type[row.source_type] ?? 0) + n;
    finding_signals += n;
  }

  const risk_signals = Math.max(0, riskSignalCount);
  const total_signals = finding_signals + risk_signals;

  return {
    total_signals,
    finding_signals,
    risk_signals,
    by_source_type,
    risks_with_active_treatment: Math.max(0, risksWithActiveTreatment)
  };
}

// ---------------------------------------------------------------------------
// buildScoringRationaleExtension
// ---------------------------------------------------------------------------

/**
 * Produce the workflow-attribution section of computation_rationale.
 * This is merged into the existing rationale object returned by computePosture.
 *
 * The returned object is safe to JSON.stringify and store in the
 * posture_snapshots.computation_rationale JSONB column.
 */
export function buildScoringRationaleExtension(
  breakdown: WorkflowSignalBreakdown
): Record<string, unknown> {
  const extension: Record<string, unknown> = {
    workflow_signal_breakdown: {
      total_signals: breakdown.total_signals,
      finding_signals: breakdown.finding_signals,
      risk_signals: breakdown.risk_signals,
      by_source_type: breakdown.by_source_type
    }
  };

  if (breakdown.risks_with_active_treatment > 0) {
    extension["risks_under_active_treatment"] = breakdown.risks_with_active_treatment;
    extension["treatment_note"] =
      `${breakdown.risks_with_active_treatment} open risk(s) have active treatment(s) in progress. ` +
      `These risks remain in scoring until treatment reaches a terminal state.`;
  }

  return extension;
}
