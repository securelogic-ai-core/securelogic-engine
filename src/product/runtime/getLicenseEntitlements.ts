import type { LicenseVersion } from "../contracts/LicenseVersion";
import type { RenderTarget } from "../../render/contracts/RenderTarget";
import { LICENSE_CAPABILITIES_V1 } from "../contracts/LicenseCapabilitiesV1";

export type LicenseTier = keyof typeof LICENSE_CAPABILITIES_V1;

export function getLicenseEntitlements(input: {
  version: LicenseVersion;
  tier: LicenseTier;
}): { allowedRenderTargets: readonly RenderTarget[] } {
  switch (input.version) {
    case "V1":
      return LICENSE_CAPABILITIES_V1[input.tier];
    default: {
      const _exhaustive: never = input.version;
      throw new Error(`Unsupported license version: ${_exhaustive}`);
    }
  }
}
