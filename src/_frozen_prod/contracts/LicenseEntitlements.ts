import type { LicenseTier } from "./LicenseTier";

export type Entitlements = {
  riskRollupLevel: "LOW" | "MEDIUM" | "HIGH";
};

export const LICENSE_ENTITLEMENTS = {
  CORE: { riskRollupLevel: "LOW" },
  PRO: { riskRollupLevel: "MEDIUM" },
  ENTERPRISE: { riskRollupLevel: "HIGH" }
} satisfies Record<LicenseTier, Entitlements>;
