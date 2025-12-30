import type { RenderTarget } from "../../render/contracts/RenderTarget";

export type LicenseTier = "CORE" | "PRO";

export const LICENSE_CAPABILITIES: Record<
  LicenseTier,
  { allowedRenderTargets: readonly RenderTarget[] }
> = {
  CORE: { allowedRenderTargets: [] },
  PRO: { allowedRenderTargets: ["PDF", "DASHBOARD"] }
};
