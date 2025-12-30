import type { RenderTarget } from "../contracts/RenderTarget";
import type { LicenseTier } from "../../product/contracts/LicenseTier";
import { RENDER_ENTITLEMENTS } from "../../product/contracts/RenderEntitlements";

export function assertLicenseAllowsTarget(
  license: LicenseTier,
  target: RenderTarget
): void {
  if (!RENDER_ENTITLEMENTS[license].includes(target)) {
    throw new Error("LICENSE_VIOLATION");
  }
}
