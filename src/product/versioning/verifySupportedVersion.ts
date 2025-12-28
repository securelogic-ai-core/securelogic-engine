import type { ResultEnvelope } from "../contracts";
import { SUPPORTED_ENVELOPE_VERSIONS } from "./SupportedVersions";

export function verifySupportedVersion(envelope: ResultEnvelope): void {
  if (!SUPPORTED_ENVELOPE_VERSIONS.includes(envelope.version as any)) {
    throw new Error("UNSUPPORTED_ENVELOPE_VERSION");
  }
}
