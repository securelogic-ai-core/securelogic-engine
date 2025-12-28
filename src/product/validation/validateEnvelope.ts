import type { ResultEnvelope } from "../contracts";

export function validateEnvelope(envelope: unknown): asserts envelope is ResultEnvelope {
  if (typeof envelope !== "object" || envelope === null) {
    throw new Error("INVALID_ENVELOPE_TYPE");
  }
  const e = envelope as Record<string, unknown>;
  if (typeof e.envelopeId !== "string") throw new Error("MISSING_ENVELOPE_ID");
  if (typeof e.version !== "string") throw new Error("MISSING_VERSION");
  if (typeof e.result !== "object" || e.result === null) {
    throw new Error("MISSING_RESULT");
  }
}
