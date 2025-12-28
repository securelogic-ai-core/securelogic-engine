export type LicenseTier = "CORE" | "PRO" | "ENTERPRISE";

export interface EnvelopePolicy {
  licenseTier: LicenseTier;
  allowedCapabilities: string[];
  issuedForTenant: string;
}
