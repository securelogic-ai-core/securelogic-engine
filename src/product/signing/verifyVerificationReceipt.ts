import type { VerificationReceiptV1, VerifierSignatureV1 } from "../contracts";
import { hashVerificationReceipt } from "../integrity/hashVerificationReceipt";
import { verifyDetached } from "./crypto";

export function verifyVerificationReceipt(
  receipt: VerificationReceiptV1,
  sig: VerifierSignatureV1,
  publicKey: Uint8Array
): boolean {
  const hash = hashVerificationReceipt(receipt);
  return verifyDetached(hash, sig.signature, publicKey);
}
