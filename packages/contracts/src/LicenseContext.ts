import type { LicenseTier } from "./LicenseTier.js";

/**
 * License Context
 * ===============
 * Immutable license metadata
 */
export interface LicenseContext {
  tier: LicenseTier;
  customerId: string;
  issuedAt: string;
}
