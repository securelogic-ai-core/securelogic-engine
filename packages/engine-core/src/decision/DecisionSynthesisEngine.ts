import "../policy/registry/bootstrapPolicies";

import crypto from "crypto";
import type { RiskContext } from "../context/RiskContext.js";
import type { Decision } from "./Decision.js";
import type { Finding } from "../findings/Finding.js";
import { scoreFindings } from "./DecisionScoringEngine.js";
import { evaluatePolicies } from "../policy/PolicyEvaluator.js";
import { writeDecisionLineage } from "./lineage/store/writeDecisionLineage.js";
import type { DecisionLineage } from "./lineage/DecisionLineage.js";

export function synthesizeDecision(
  context: RiskContext,
  findings: Finding[],
  policyBundle: { bundleId: string; bundleHash: string; policies: any[] },
  dryRun?: boolean
): Decision {
  const createdAt = new Date().toISOString();
  const decisionId = crypto.randomUUID();

  // 1) Risk computation
  const riskRating = scoreFindings(findings);

  // 2) Default outcome
  let outcome: Decision["outcome"] = "APPROVED";

  if (riskRating === "CRITICAL") outcome = "REJECTED";
  else if (riskRating === "HIGH") outcome = "NEEDS_REVIEW";

  // 3) Policy evaluation
  const policyResults = evaluatePolicies(policyBundle, {
    context,
    findings
  });

  // 4) Apply policy overrides
  for (const r of policyResults) {
    if (r.effect === "DENY") outcome = "REJECTED";
    if (r.effect === "REQUIRE_REVIEW" && outcome !== "REJECTED") {
      outcome = "NEEDS_REVIEW";
    }
  }

  // 5) Conditions
  const conditions =
    outcome === "NEEDS_REVIEW"
      ? findings.map((f, i) => ({
          id: `COND-${i + 1}`,
          description: `High risk finding: ${f.title}`,
          severity: "MEDIUM" as const
        }))
      : [];

  // 6) Decision object
  const decision: Decision = {
    decisionId,
    contextId: context.contextId,
    outcome,
    riskRating,
    conditions,
    createdAt,
    policyBundleId: policyBundle.bundleId,
    policyBundleHash: policyBundle.bundleHash
  };

  // 7) Lineage (AUDIT RECORD)
  const lineage: DecisionLineage = {
    schemaVersion: "1.0",
    engineVersion: "2026.01",

    decisionId,
    contextId: context.contextId,

    policyBundleId: policyBundle.bundleId,
    policyBundleHash: policyBundle.bundleHash,

    findingsSnapshot: JSON.parse(JSON.stringify(findings)),

    policyEvaluations: policyResults.map((r: any) => ({
      policyId: r.policyId,
      effect: r.effect,
      reason: r.reason ?? null
    })),

    riskComputation: {
      method: "scoreFindings()",
      finalRisk: riskRating
    },

    aggregation: {
      rule: "RiskScore + PolicyOverrides",
      finalOutcome: outcome,
      finalRisk: riskRating
    },

    createdAt
  };

  if (!dryRun) {
    writeDecisionLineage(lineage);
  }

  return decision;
}