import type { IntakeEnvelopeV1 } from "../IntakeEnvelopeV1";

export function verifyIntakeEnvelopeV1(
  envelope: IntakeEnvelopeV1
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (envelope.version !== "V1") errors.push("INVALID_VERSION");
  if (!envelope.runId) errors.push("MISSING_RUN_ID");
  if (!envelope.organization?.orgId) errors.push("MISSING_ORG_ID");
  if (!envelope.license?.tier) errors.push("MISSING_LICENSE_TIER");
  if (!Array.isArray(envelope.evidence)) errors.push("EVIDENCE_NOT_ARRAY");

  return errors.length ? { valid: false, errors } : { valid: true };
}
