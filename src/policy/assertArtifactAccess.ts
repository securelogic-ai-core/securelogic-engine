import type { LicenseTier } from "../customer/LicenseTier";

export function assertArtifactAccess(
  tier: LicenseTier,
  artifactType: string
) {
  if (tier === "CORE") {
    throw new Error("LICENSE_DENIED");
  }

  if (tier === "PRO" && artifactType !== "PDF") {
    throw new Error("LICENSE_DENIED");
  }
}
