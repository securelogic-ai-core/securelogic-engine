export type LicenseTier = "Starter" | "Professional" | "Enterprise";

export interface LicenseContext {
  tier: LicenseTier;
}
