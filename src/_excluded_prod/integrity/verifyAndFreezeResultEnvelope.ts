import type { ResultEnvelope } from "../contracts";
import { verifyResultEnvelope } from "./verifyResultEnvelope";
import { deepFreeze } from "./deepFreeze";

export function verifyAndFreezeResultEnvelope(
  envelope: ResultEnvelope
): ResultEnvelope {
  if (!verifyResultEnvelope(envelope)) {
    throw new Error("Invalid ResultEnvelope — verification failed");
  }

  return deepFreeze(envelope);
}
