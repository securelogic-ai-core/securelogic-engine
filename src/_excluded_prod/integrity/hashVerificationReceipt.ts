import type { VerificationReceiptV1 } from "../contracts";
import { canonicalize } from "./canonicalize";
import { createHash } from "crypto";

export function hashVerificationReceipt(
  receipt: VerificationReceiptV1
): string {
  const canonical = canonicalize(receipt);
  return createHash("sha256").update(canonical).digest("hex");
}
