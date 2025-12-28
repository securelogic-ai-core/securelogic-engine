import type { ResultEnvelope } from "../contracts";
import type { VerificationPolicy } from "./VerificationPolicy";
import { verifyResultEnvelopeCore } from "./verifyResultEnvelopeCore";
import { verifyResultEnvelopeWithResult } from "./verifyResultEnvelopeWithResult";
import { hasSeenEnvelope, markEnvelopeSeen } from "./replayCache";

export function verifyWithPolicy(
  envelope: ResultEnvelope,
  policy: VerificationPolicy
): boolean {
  if (policy.blockReplay && hasSeenEnvelope(envelope)) {
    return false;
  }

  if (!verifyResultEnvelopeCore(envelope)) {
    return false;
  }

  if (policy.requireLineage) {
    if (!verifyResultEnvelopeWithResult(envelope)) {
      return false;
    }
  }

  markEnvelopeSeen(envelope);
  return true;
}

import { appendAuditLog } from "./auditLog";

const POLICY_ID = "default";

export function verifyWithPolicy(
  envelope: ResultEnvelope,
  policy: VerificationPolicy
): boolean {
  const success = (
    (!policy.blockReplay || !hasSeenEnvelope(envelope)) &&
    verifyResultEnvelopeCore(envelope) &&
    (!policy.requireLineage || verifyResultEnvelopeWithResult(envelope))
  );

  appendAuditLog({
    envelopeId: envelope.envelopeId,
    verifiedAt: new Date().toISOString(),
    policyId: POLICY_ID,
    success
  });

  if (success) {
    markEnvelopeSeen(envelope);
  }

  return success;
}

import { appendAuditLog } from "./auditLog";

const POLICY_ID = "default";

export function verifyWithPolicy(
  envelope: ResultEnvelope,
  policy: VerificationPolicy
): boolean {
  const success = (
    (!policy.blockReplay || !hasSeenEnvelope(envelope)) &&
    verifyResultEnvelopeCore(envelope) &&
    (!policy.requireLineage || verifyResultEnvelopeWithResult(envelope))
  );

  appendAuditLog({
    envelopeId: envelope.envelopeId,
    verifiedAt: new Date().toISOString(),
    policyId: POLICY_ID,
    success
  });

  if (success) {
    markEnvelopeSeen(envelope);
  }

  return success;
}

import { appendAuditLog } from "./auditLog";

const POLICY_ID = "default";

export function verifyWithPolicy(
  envelope: ResultEnvelope,
  policy: VerificationPolicy
): boolean {
  const success = (
    (!policy.blockReplay || !hasSeenEnvelope(envelope)) &&
    verifyResultEnvelopeCore(envelope) &&
    (!policy.requireLineage || verifyResultEnvelopeWithResult(envelope))
  );

  appendAuditLog({
    envelopeId: envelope.envelopeId,
    verifiedAt: new Date().toISOString(),
    policyId: POLICY_ID,
    success
  });

  if (success) {
    markEnvelopeSeen(envelope);
  }

  return success;
}
