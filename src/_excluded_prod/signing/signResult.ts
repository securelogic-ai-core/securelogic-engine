import { createSign } from "crypto";
import { canonicalize } from "../integrity/canonicalize";
import type { AuditSprintResultV1 } from "../contracts/result";
import type { ResultSignatureV1 } from "../contracts/signature/ResultSignature";

/**
 * Signs an audit result without mutating integrity hash
 */
export function signResult(
  result: AuditSprintResultV1,
  privateKeyPem: string,
  signer: ResultSignatureV1["signer"],
  algorithm: ResultSignatureV1["algorithm"] = "rsa-sha256"
): ResultSignatureV1 {
  const { integrity, signature, ...payload } = result;

  const canonical = canonicalize(payload);

  const signerInstance = createSign("RSA-SHA256");
  signerInstance.update(canonical);
  signerInstance.end();

  const signatureValue = signerInstance.sign(privateKeyPem, "base64");

  return {
    algorithm,
    signer,
    signature: signatureValue,
    signedAt: new Date().toISOString()
  };
}
