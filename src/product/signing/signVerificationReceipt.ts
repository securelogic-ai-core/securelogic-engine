import type { VerificationReceiptV1, VerifierSignatureV1 } from "../contracts";
import { hashVerificationReceipt } from "../integrity/hashVerificationReceipt";
import { signDetached } from "./crypto";

export function signVerificationReceipt(
  receipt: VerificationReceiptV1,
  privateKey: Uint8Array,
  verifierId: string
): VerifierSignatureV1 {
  const hash = hashVerificationReceipt(receipt);
  const signature = signDetached(hash, privateKey);

  return {
    verifierId,
    algorithm: "ed25519",
    signature,
    signedAt: new Date().toISOString()
  };
}
