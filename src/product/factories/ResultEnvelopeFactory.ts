import type { AuditSprintResultV1 } from "../contracts";

export interface ResultEnvelopeV1 {
  kind: "result-envelope";
  version: "result-envelope-v1";
  payload: AuditSprintResultV1;
  integrity: {
    algorithm: "sha256";
    hash: string;
    generatedAt: string;
  };
}

function sha256(input: string): string {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function createResultEnvelopeV1(
  payload: AuditSprintResultV1
): ResultEnvelopeV1 {
  const serialized = JSON.stringify(payload);
  return {
    kind: "result-envelope",
    version: "result-envelope-v1",
    payload,
    integrity: {
      algorithm: "sha256",
      hash: sha256(serialized),
      generatedAt: new Date().toISOString()
    }
  };
}
