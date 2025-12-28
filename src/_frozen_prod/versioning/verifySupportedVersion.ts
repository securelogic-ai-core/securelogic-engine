import type { ResultEnvelope } from "../contracts";
import { SUPPORTED_ENVELOPE_VERSIONS } from "./SupportedVersions";
import type { SupportedEnvelopeVersion } from "./SupportedVersions";

export function verifySupportedVersion(
  envelope: ResultEnvelope
): asserts envelope is ResultEnvelope & {
  version: SupportedEnvelopeVersion;
} {
  if (!SUPPORTED_ENVELOPE_VERSIONS.includes(envelope.version)) {
    throw new Error("UNSUPPORTED_ENVELOPE_VERSION");
  }
}
