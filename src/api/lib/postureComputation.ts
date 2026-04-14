/**
 * postureComputation.ts
 *
 * Pure computation logic for posture snapshots.
 *
 * Reuses DomainRiskAggregationEngineV2 and OverallRiskAggregationEngineV2
 * — the same engines used by the assessment runner — to ensure scoring
 * is consistent across the platform. Domain scores and the overall score
 * are computed from the same algorithm and the same policy.
 *
 * Organization context weighting (regulated, handlesPII, safetyCritical,
 * scale) is applied using the org profile columns added in migration
 * 20260411_org_profile_context_weighting.sql. Scores now reflect actual
 * org context: a regulated, enterprise-scale org with identical findings
 * will receive a higher risk score than a non-regulated small org.
 *
 * FALLBACK_CONTEXT is used only when the org profile cannot be read from
 * the database (should not occur in production; the org is always resolved
 * from the API key). It is not a neutral default — it is an emergency safe
 * fallback that must be logged when reached.
 *
 * This module has no I/O dependencies and is fully unit-testable.
 */

import { DomainRiskAggregationEngineV2 } from "../../engine/scoring/v2/DomainRiskAggregationEngineV2.js";
import { OverallRiskAggregationEngineV2 } from "../../engine/scoring/v2/OverallRiskAggregationEngineV2.js";
import type { Finding } from "../../reporting/ReportSchema.js";

// Valid engine severity levels — must match the engine's RiskLevel contract
const VALID_ENGINE_SEVERITY = new Set(["Low", "Moderate", "High", "Critical"]);

/**
 * Coerce a DB text severity value to one the engine can consume.
 * Falls back to "Low" for any unexpected value rather than throwing,
 * since findings may have been inserted before constraint enforcement.
 */
function toEngineRiskLevel(
  severity: string
): "Low" | "Moderate" | "High" | "Critical" {
  if (VALID_ENGINE_SEVERITY.has(severity)) {
    return severity as "Low" | "Moderate" | "High" | "Critical";
  }
  return "Low";
}

/**
 * Derive a canonical priority tier from a finding's severity.
 * This is deterministic and used when persisting new assessment findings.
 */
export function severityToPriority(
  severity: string
): "immediate" | "near_term" | "planned" | "watch" {
  if (severity === "Critical") return "immediate";
  if (severity === "High") return "near_term";
  if (severity === "Moderate") return "planned";
  return "watch";
}

// ----------------------------------------------------------------
// Input / output types
// ----------------------------------------------------------------

/**
 * The minimal shape of a finding row as read from the DB
 * for posture computation purposes. Does not represent the
 * full findings table schema.
 */
export type DbFindingForPosture = {
  id: string;
  title: string;
  domain: string | null;
  severity: string;
};

/**
 * Organization context shape passed into posture computation.
 * Sourced from the organizations table — not inferred or defaulted by this module.
 * Maps directly to the engine's EngineInput["context"] shape.
 */
export type OrgContext = {
  regulated: boolean;
  handlesPII: boolean;
  safetyCritical: boolean;
  scale: "Small" | "Medium" | "Enterprise";
};

/**
 * Emergency fallback context — used only when the org profile cannot be read.
 * Equivalent to the previous neutral multiplier behaviour (contextMultiplier = 1.0).
 * Callers must log a warning when this is used in production.
 */
export const FALLBACK_CONTEXT: OrgContext = {
  regulated: false,
  handlesPII: false,
  safetyCritical: false,
  scale: "Small"
};

export type DomainScoreResult = {
  domain: string;
  score: number | null;
  severity: string | null;
  finding_count: number;
  rationale: string;
};

export type PostureComputationResult = {
  overall_score: number | null;
  overall_severity: string | null;
  open_finding_count: number;
  open_action_count: number;
  overdue_action_count: number;
  domain_scores: DomainScoreResult[];
  computation_rationale: Record<string, unknown>;
};

// ----------------------------------------------------------------
// Computation
// ----------------------------------------------------------------

/**
 * Compute a posture snapshot from a set of signals (findings + risks),
 * action counts, and the calling organization's context profile.
 *
 * orgContext is read from the organizations table by the posture route
 * before calling this function. It must not be defaulted to FALLBACK_CONTEXT
 * silently — callers must log a warning if they fall back.
 *
 * riskSignalCount — the number of open risk register entries included in
 * the signals array. Used only in the computation_rationale for transparency;
 * does not affect scoring. Defaults to 0 when called from pre-risk-integration
 * code paths.
 *
 * Returns null overall_score when there are no signals — this is honest
 * and must be represented as "insufficient data" in the presentation layer,
 * not as a score of zero.
 */
export function computePosture(
  findings: DbFindingForPosture[],
  openActionCount: number,
  overdueActionCount: number,
  orgContext: OrgContext = FALLBACK_CONTEXT,
  riskSignalCount: number = 0
): PostureComputationResult {
  // Build a human-readable summary of the context applied — used in rationale.
  const contextSummary = [
    orgContext.regulated ? "regulated" : null,
    orgContext.handlesPII ? "handles_pii" : null,
    orgContext.safetyCritical ? "safety_critical" : null,
    `scale:${orgContext.scale}`
  ]
    .filter(Boolean)
    .join(", ");

  if (findings.length === 0) {
    return {
      overall_score: null,
      overall_severity: null,
      open_finding_count: 0,
      open_action_count: openActionCount,
      overdue_action_count: overdueActionCount,
      domain_scores: [],
      computation_rationale: {
        note: "No open findings available. Score cannot be computed.",
        context_applied: {
          regulated: orgContext.regulated,
          handles_pii: orgContext.handlesPII,
          safety_critical: orgContext.safetyCritical,
          scale: orgContext.scale
        },
        engine: "DomainRiskAggregationEngineV2 + OverallRiskAggregationEngineV2"
      }
    };
  }

  // Map DB finding rows to the minimal shape the engine needs.
  // The aggregation engine only reads: domain, severity, title, id (id only in EXPLAIN mode).
  // Remaining Finding fields are required by the type but not accessed during scoring.
  // The cast to Finding[] is safe here and is the same pattern used in engine tests.
  const engineContext = {
    regulated: orgContext.regulated,
    safetyCritical: orgContext.safetyCritical,
    handlesPII: orgContext.handlesPII,
    scale: orgContext.scale
  };

  const engineFindings: Finding[] = findings.map((f) => ({
    id: f.id,
    title: f.title,
    domain: f.domain ?? "General", // null domain → General; not fabricated, just bucketed
    severity: toEngineRiskLevel(f.severity),
    mappedFrameworks: [],
    evidenceItems: [],
    confidence: "Low" as const,
    confidenceScore: 0,
    confidenceRationale: "",
    businessImpact: "",
    evidence: "",
    recommendation: ""
  })) as unknown as Finding[];

  const domainProfiles = DomainRiskAggregationEngineV2.aggregate(
    engineFindings,
    engineContext
  );

  const overall =
    domainProfiles.length > 0
      ? OverallRiskAggregationEngineV2.aggregate(domainProfiles)
      : null;

  const domainScores: DomainScoreResult[] = domainProfiles.map((profile) => ({
    domain: profile.domain,
    score: profile.finalScore,
    severity: profile.severity,
    finding_count: profile.findingCount,
    rationale:
      `${profile.findingCount} finding(s); ` +
      `max severity ${profile.maxSeverity}; ` +
      `base score ${profile.baseScore}; ` +
      `context multiplier ${profile.contextMultiplier} (${contextSummary})`
  }));

  const nullDomainCount = findings.filter((f) => f.domain === null).length;

  const findingSignalCount = findings.length - riskSignalCount;
  const noteparts: string[] = [
    `Computed from ${findings.length} signal(s) across ${domainProfiles.length} domain(s)`
  ];
  if (riskSignalCount > 0) {
    noteparts.push(
      `${findingSignalCount} finding(s) + ${riskSignalCount} open risk(s)`
    );
  }

  return {
    overall_score: overall?.score ?? null,
    overall_severity: overall?.severity ?? null,
    open_finding_count: findings.length,
    open_action_count: openActionCount,
    overdue_action_count: overdueActionCount,
    domain_scores: domainScores,
    computation_rationale: {
      note: noteparts.join(" — "),
      context_applied: {
        regulated: orgContext.regulated,
        handles_pii: orgContext.handlesPII,
        safety_critical: orgContext.safetyCritical,
        scale: orgContext.scale
      },
      engine: "DomainRiskAggregationEngineV2 + OverallRiskAggregationEngineV2",
      policy: "DEFAULT_SCORING_POLICY",
      null_domain_findings: nullDomainCount > 0
        ? `${nullDomainCount} finding(s) with no domain bucketed under "General"`
        : 0,
      risk_signals_included: riskSignalCount
    }
  };
}
