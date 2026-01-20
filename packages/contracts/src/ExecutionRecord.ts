import type { RiskContext } from "./RiskContext.js";
import type { DecisionLineage } from "./DecisionLineage.js";
import type { Decision } from "./Decision.js";

export interface ExecutionRecord {
  schemaVersion: "1.0";

  executionId: string;

  context: RiskContext;
  policyBundleId: string;
  policyBundleHash: string;

  decision: Decision;
  lineage: DecisionLineage;

  producedAt: string;
  engineVersion: string;
}
