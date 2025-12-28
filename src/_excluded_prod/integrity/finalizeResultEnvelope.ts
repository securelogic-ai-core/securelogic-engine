import type { ResultEnvelope } from "../contracts";
import { deepFreeze } from "./deepFreeze";

export function finalizeResultEnvelope(
  envelope: ResultEnvelope
): Readonly<ResultEnvelope> {
  return deepFreeze(envelope);
}
