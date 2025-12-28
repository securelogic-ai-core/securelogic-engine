import type { DataResidencyV1 } from "./DataResidencyV1";

export function assertDataResidency(
  residency: DataResidencyV1,
  targetRegion: string
): void {
  if (residency.region !== targetRegion) {
    throw new Error("DATA_RESIDENCY_VIOLATION");
  }
}
