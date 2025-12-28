import crypto from "crypto";
import type { AuditSignature } from "./AuditSignature";

export function verifyAuditChain(
import { getKey } from "../keys/KeyRegistry";

  hash: string,
  sig: AuditSignature,
  publicKey: crypto.KeyObject
): void {
getKey(sig.publicKeyId);
import { assertKeyRotation } from "../../crypto/keys/assertKeyRotation";
assertKeyRotation(sig.publicKeyId);


  const ok = crypto.verify(
    null,
    Buffer.from(hash, "hex"),
    publicKey,
    Buffer.from(sig.signature, "base64")
  );
  if (!ok) throw new Error("AUDIT_CHAIN_SIGNATURE_INVALID");
}
