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
 * Organization context weighting (regulated, handlesPII, scale) is not
 * applied in this version because the organizations table does not yet
 * carry those fields. A neutral context (contextMultiplier = 1.0) is used,
 * which means scores reflect finding severity alone without amplification.
 * This is noted in computation_rationale. Context weighting is a subsequent
 * package once org profile columns are added.
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

const NEUTRAL_CONTEXT = {
  regulated: false,
  safetyCritical: false,
  handlesPII: false,
  scale: "Small" as const
};

/**
 * Compute a posture snapshot from a set of open findings and action counts.
 *
 * Returns null overall_score when there are no findings — this is honest
 * and must be represented as "insufficient data" in the presentation layer,
 * not as a score of zero.
 */
export function computePosture(
  findings: DbFindingForPosture[],
  openActionCount: number,
  overdueActionCount: number
): PostureComputationResult {
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
        context_weighting: "not applied — org profile not yet configured",
        engine: "DomainRiskAggregationEngineV2 + OverallRiskAggregationEngineV2"
      }
    };
  }

  // Map DB finding rows to the minimal shape the engine needs.
  // The aggregation engine only reads: domain, severity, title, id (id only in EXPLAIN mode).
  // Remaining Finding fields are required by the type but not accessed during scoring.
  // The cast to Finding[] is safe here and is the same pattern used in engine tests.
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
    NEUTRAL_CONTEXT
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
      `context multiplier ${profile.contextMultiplier} (neutral)`
  }));

  const nullDomainCount = findings.filter((f) => f.domain === null).length;

  return {
    overall_score: overall?.score ?? null,
    overall_severity: overall?.severity ?? null,
    open_finding_count: findings.length,
    open_action_count: openActionCount,
    overdue_action_count: overdueActionCount,
    domain_scores: domainScores,
    computation_rationale: {
      note: `Computed from ${findings.length} open finding(s) across ${domainProfiles.length} domain(s).`,
      context_weighting:
        "neutral — org profile (regulated, handlesPII, scale) not yet configured; " +
        "context multiplier = 1.0; no amplification applied",
      engine: "DomainRiskAggregationEngineV2 + OverallRiskAggregationEngineV2",
      policy: "DEFAULT_SCORING_POLICY",
      null_domain_findings: nullDomainCount > 0
        ? `${nullDomainCount} finding(s) with no domain bucketed under "General"`
        : 0,
      limitation:
        "Add org profile columns (regulated, handles_pii, safety_critical, scale) " +
        "to organizations table to enable context-weighted posture scoring."
    }
  };
}
