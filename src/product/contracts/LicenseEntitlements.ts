import type { RenderTarget } from "@/render/contracts/RenderTarget";

export type LicenseTier = "CORE" | "PRO";

export type RenderEntitlements = {
  readonly renderTargets: readonly RenderTarget[];
};

export const LICENSE_ENTITLEMENTS = {
  CORE: {
    renderTargets: ["PDF"] as const
  },
  PRO: {
    renderTargets: ["PDF", "DASHBOARD", "JSON"] as const
  }
} satisfies Record<LicenseTier, RenderEntitlements>;
