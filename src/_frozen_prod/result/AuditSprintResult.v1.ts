export interface AuditSprintResultV1 {
  kind: "AuditSprintResult";
  version: "v1";

  meta: unknown;
  executionContext: unknown;
  scoring: unknown;
  executiveSummary: unknown;
  findings: unknown[];
  riskRollup: unknown;
  remediationPlan: unknown;
  controlTraces: unknown[];

  domains: unknown[];
  summary: unknown;

  evidence: unknown[];
  evidenceLinks: unknown[];
  attestations: unknown[];

  integrity?: unknown;
}
