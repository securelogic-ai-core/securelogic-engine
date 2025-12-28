import type { FeatureFlagV1 } from "./FeatureFlagV1";

export function assertFeatureEnabled(flag: FeatureFlagV1): void {
  if (!flag.enabled) {
    throw new Error("FEATURE_DISABLED");
  }
}
