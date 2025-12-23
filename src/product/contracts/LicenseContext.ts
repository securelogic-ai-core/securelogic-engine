import type { LicenseTier } from "./LicenseTier";

/**
 * Runtime license context.
 * Passed into SecureLogicAI at execution time.
 */
export interface LicenseContext {
  tier: LicenseTier;
  organizationId: string;
}
