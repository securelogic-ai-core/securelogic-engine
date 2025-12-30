import "./renderEntitlements.assert";

import type { LicenseTier } from "./LicenseTier";
import type { RenderTarget } from "../../render/contracts/RenderTarget";

export const RENDER_ENTITLEMENTS: Record<LicenseTier, readonly RenderTarget[]> = {
  CORE: ["PDF", "JSON"],
  PRO: ["PDF", "DASHBOARD", "JSON"]
} as const;
