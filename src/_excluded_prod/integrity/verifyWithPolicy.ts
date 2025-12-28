import type { ResultEnvelope } from "../contracts";
import type { VerificationPolicy } from "./VerificationPolicy";
import type { VerificationMode } from "./VerificationMode";
import type { VerificationResult } from "./VerificationResult";
import { verifyResultEnvelopeWithResult } from "./verifyResultEnvelopeWithResult";
import { buildVerificationReceipt } from "./buildVerificationReceipt";
import { hashVerificationReceipt } from "./hashVerificationReceipt";

export function verifyWithPolicy(
  envelope: ResultEnvelope,
  policy: VerificationPolicy,
  mode: VerificationMode
): VerificationResult {
  if (!mode) throw new Error("VERIFICATION_MODE_REQUIRED");
  if (!policy) throw new Error("VERIFICATION_POLICY_REQUIRED");

  const core = verifyResultEnvelopeWithResult(envelope);
  const receipt = buildVerificationReceipt(envelope, core.valid);
  const receiptHash = hashVerificationReceipt(receipt);

  return {
    valid: core.valid,
    reason: core.valid ? "OK" : core.reason,
    receipt,
    receiptHash,
    mode
  };
}
