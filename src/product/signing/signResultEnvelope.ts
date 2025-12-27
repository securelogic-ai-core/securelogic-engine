import type { ResultEnvelope, ResultSignatureV1 } from "../contracts";
import { hashEnvelope } from "../integrity/hashEnvelope";
import { deepFreeze } from "../integrity/deepFreeze";

export function signResultEnvelope(
  envelope: ResultEnvelope
): ResultEnvelope {
  const signature: ResultSignatureV1 = {
    version: "result-signature-v1",
    keyId: "local-dev",
    algorithm: "sha256",
    signature: hashEnvelope({
      ...envelope,
      signatures: []
    }),
    signedAt: new Date().toISOString()
  };

  const signed: ResultEnvelope = {
    ...envelope,
    signatures: [...(envelope.signatures ?? []), signature]
  };

  return deepFreeze(signed);
}
