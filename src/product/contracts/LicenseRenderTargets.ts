import "./license.assert";
import { RENDER_TARGETS } from "../../render/contracts/RenderTarget";

export type LicenseTier = "CORE" | "PRO";

export const LICENSE_RENDER_TARGETS: Record<
  LicenseTier,
  readonly (typeof RENDER_TARGETS[number])[]
> = {
  CORE: ["PDF"],
  PRO: ["PDF", "DASHBOARD", "JSON"]
} as const;
