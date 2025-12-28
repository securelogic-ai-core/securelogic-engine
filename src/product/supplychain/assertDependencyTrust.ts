import type { DependencyManifestV1 } from "./DependencyManifestV1";

export function assertDependencyTrust(dep: DependencyManifestV1): void {
  if (!dep.checksum) {
    throw new Error("UNVERIFIED_DEPENDENCY");
  }
}
