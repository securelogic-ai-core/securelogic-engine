import { getKey } from "../../crypto/keys/KeyRegistry";
import type { AuditSignature } from "./AuditSignature";

export function verifyAuditChain(
  signature: AuditSignature
): void {
  const key = getKey(signature.publicKeyId);

  if (key.revokedAt) {
    throw new Error("KEY_REVOKED");
  }
}
