import "./license.assert";
import type { RenderTarget } from "../../render/contracts/RenderTarget";

export const LICENSE_RENDER_ENTITLEMENTS = {
  CORE: ["PDF", "JSON"],
  PRO: ["PDF", "DASHBOARD", "JSON"]
} as const satisfies Record<string, readonly RenderTarget[]>;
