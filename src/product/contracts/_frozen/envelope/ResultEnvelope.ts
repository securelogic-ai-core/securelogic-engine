import type { AuditSprintResultV1 } from "../result/AuditSprintResultV1";

export interface ResultEnvelope {
  version: "result-envelope-v1";
  issuedAt: string;
  result: AuditSprintResultV1;
  signatures?: unknown[];
  attestations?: unknown[];
}
