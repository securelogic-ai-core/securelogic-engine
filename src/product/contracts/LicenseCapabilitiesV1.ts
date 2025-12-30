import type { RenderTarget } from "../../render/contracts/RenderTarget";

export type LicenseTier = "CORE" | "PRO";

export const LICENSE_CAPABILITIES_V1: Record<LicenseTier, {
  allowedRenderTargets: readonly RenderTarget[];
}> = {
  CORE: { allowedRenderTargets: [] },
  PRO: { allowedRenderTargets: ["PDF", "DASHBOARD"] }
} as const;
