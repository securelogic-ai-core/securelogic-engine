import type { VersionManifestV1 } from "./VersionManifestV1";

export function assertCompatible(manifest: VersionManifestV1): void {
  if (manifest.apiVersion !== manifest.engineVersion) {
    throw new Error("VERSION_INCOMPATIBLE");
  }
}
