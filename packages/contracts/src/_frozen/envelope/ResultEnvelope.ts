import type { AuditSprintResultV1 } from "../result/AuditSprintResultV1.js";
import type { AttestationV1 as ResultAttestationV1 } from "../attestation/AttestationV1.js";

export interface ResultLineageV1 {
  parentHash?: string;
  chainHash: string;
}

export interface ResultIdentityV1 {
  envelopeId: string;
}

export interface ResultEnvelope extends ResultIdentityV1 {
  version: "result-envelope-v1";
  issuedAt: string;
  result: AuditSprintResultV1;
  lineage: ResultLineageV1;
  signatures?: unknown[];
  attestations?: ResultAttestationV1[];
}
