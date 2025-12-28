import type { LicenseTier } from "./LicenseTier.js";

export type Entitlements = {
  riskRollupLevel: "LOW" | "MEDIUM" | "HIGH";
};

export const LICENSE_ENTITLEMENTS: Record<LicenseTier, Entitlements> = {
  CORE: { riskRollupLevel: "LOW" },
  PRO: { riskRollupLevel: "MEDIUM" },
  ENTERPRISE: { riskRollupLevel: "HIGH" }
};
