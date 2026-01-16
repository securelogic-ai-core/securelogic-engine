import type { ExecutionEnvelope } from "./ExecutionEnvelope.js";
import type { ReplayCertificate } from "./ReplayCertificate.js";
import { verifyReplay } from "./ReplayVerifier.js";
import { hashObject } from "../utils/hasher.js";

export function certifyReplay(
  envelope: ExecutionEnvelope,
  context: any,
  findings: any[],
  policyBundle: any
): ReplayCertificate {
  const result = verifyReplay(
    envelope.record,
    context,
    findings,
    policyBundle
  );

  return {
    executionHash: hashObject(envelope.record),
    verified: result.matches,
    timestamp: new Date().toISOString()
  };
}
