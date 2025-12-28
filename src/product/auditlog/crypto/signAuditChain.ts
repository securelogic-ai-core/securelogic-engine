import crypto from "crypto";
import type { AuditEventV1 } from "../AuditEventV1";
import type { AuditSignature } from "./AuditSignature";

export function signAuditChain(
  head: AuditEventV1,
  privateKey: crypto.KeyObject,
  publicKeyId: string
): AuditSignature {
  const data = Buffer.from(head.hash, "hex");
  const signature = crypto.sign(null, data, privateKey).toString("base64");
  return { algorithm: "ed25519", publicKeyId, signature };
}
