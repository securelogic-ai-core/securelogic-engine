import type { ResultEnvelope } from "../contracts";

const SUPPORTED_VERSIONS = ["result-envelope-v1"] as const;

export function verifyEnvelopeVersion(envelope: ResultEnvelope): boolean {
  return SUPPORTED_VERSIONS.includes(envelope.version);
}
