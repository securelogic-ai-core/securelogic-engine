import type { LicenseTier } from "./LicenseTier";
import type { RiskRollupV1 } from "./result/RiskRollupV1";

export type Entitlements = {
  riskRollup: RiskRollupV1;
};

export const LICENSE_ENTITLEMENTS: Record<LicenseTier, Entitlements> = {
  BASIC: {
    riskRollup: { level: "LOW" }
  },
  PRO: {
    riskRollup: { level: "MEDIUM" }
  },
  ENTERPRISE: {
    riskRollup: { level: "HIGH" }
  }
};
