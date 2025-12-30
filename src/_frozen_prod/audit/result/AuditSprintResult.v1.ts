/**
 * IMMUTABLE AUDIT OUTPUT — ENTERPRISE CONTRACT
 * Any change REQUIRES a version bump.
 */
export type AuditSprintResultV1 = {
  kind: "AuditSprintResult";
  version: "v1";

  meta: {
    auditId: string;
    generatedAt: string;
    engineVersion: string;
    licenseTier: string;
  };

  executionContext: {
    systemName: string;
    owner: string;
    frameworks: string[];
  };

  scoring: unknown;
  executiveSummary: unknown;

  findings: unknown[];

  riskRollup: unknown;

  remediationPlan: unknown;

  controlTraces: unknown[];
  evidence: unknown[];
  evidenceLinks: unknown[];
  attestations: unknown[];

  integrity: {
    payloadHash: string;
    signatures: unknown[];
  };
};
