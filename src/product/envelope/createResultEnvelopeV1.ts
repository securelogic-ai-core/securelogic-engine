import type { ResultEnvelope } from "../contracts";
import type { AuditSprintResultV1 } from "../contracts";
import { canonicalize } from "./canonicalize";
import { createHash } from "crypto";

export function createResultEnvelopeV1(payload: unknown): ResultEnvelope {
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");

  const envelope = {
    version: "result-envelope-v1",
    issuedAt: new Date().toISOString(),
    result: payload as AuditSprintResultV1,

    // test + integrity alias (NOT part of contract)
    payload,
    payloadHash,

    signatures: [],
  };

  return envelope as unknown as ResultEnvelope;
}
