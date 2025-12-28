import type { ReleaseArtifactV1 } from "./ReleaseArtifactV1";

export function assertReleaseIntegrity(
  artifact: ReleaseArtifactV1,
  expectedHash: string
): void {
  if (artifact.hash !== expectedHash) {
    throw new Error("RELEASE_INTEGRITY_VIOLATION");
  }
}
