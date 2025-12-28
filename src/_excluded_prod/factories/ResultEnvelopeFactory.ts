import type { ResultEnvelope } from "../contracts";
import { createResultEnvelopeV1 } from "../envelope/createResultEnvelopeV1";

export function createResultEnvelopeV1Factory(
  payload: unknown
): ResultEnvelope {
  return createResultEnvelopeV1(payload);
}

// BACKWARD-COMPAT EXPORT (USED BY TESTS)
export { createResultEnvelopeV1Factory as createResultEnvelopeV1 };
