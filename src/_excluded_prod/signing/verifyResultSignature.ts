import type { ResultEnvelope, ResultSignatureV1 } from "../contracts";
import { hashEnvelope } from "../integrity/hashEnvelope";

export function verifyResultSignature(
  envelope: ResultEnvelope,
  signature: ResultSignatureV1
): boolean {
  if (signature.version !== "result-signature-v1") return false;
  if (signature.algorithm !== "sha256") return false;

  const expected = hashEnvelope({
    ...envelope,
    signatures: []
  });

  return expected === signature.signature;
}
