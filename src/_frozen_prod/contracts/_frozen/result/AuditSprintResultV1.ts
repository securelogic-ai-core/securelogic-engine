export interface AuditSprintResultV1 {
  kind: "audit-sprint-result";
  version: "audit-sprint-result-v1";

  meta: {
    generatedAt: string;
    licenseTier: string;
  };

  domains: unknown[];
  findings: unknown[];
  summary: Record<string, unknown>;

  integrity?: {
    algorithm: string;
    hash: string;
    generatedAt: string;
  };
}
