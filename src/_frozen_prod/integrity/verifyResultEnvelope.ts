import crypto from "crypto";
import { checkReplay } from "./replayCache";

export function verifyResultEnvelope(envelope: any): boolean {
  if (checkReplay(envelope.nonce)) return false;

  if (!envelope.signatures || envelope.signatures.length === 0) return true;

  const sig = envelope.signatures[0];
  if (sig.algorithm !== "sha256") return false;

  const expected = crypto
    .createHash("sha256")
    .update(JSON.stringify(envelope.payload))
    .digest("hex");

  return sig.value === expected;
}
