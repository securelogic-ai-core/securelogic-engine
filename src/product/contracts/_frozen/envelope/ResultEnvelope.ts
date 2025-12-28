import type { AuditSprintResultV1 } from "../result/AuditSprintResultV1";
import type { ResultAttestationV1 } from "../../ResultAttestationV1";
import type { ResultLineageV1 } from "../../ResultLineageV1";
import type { ResultIdentityV1 } from "../../ResultIdentityV1";

export interface ResultEnvelope extends ResultIdentityV1 {
  version: "result-envelope-v1";
  issuedAt: string;
  result: AuditSprintResultV1;
  lineage: ResultLineageV1;
  signatures?: unknown[];
  attestations?: ResultAttestationV1[];
}
