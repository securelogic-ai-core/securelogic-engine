/**
 * LicenseTier
 * ===========
 * Canonical license tiers.
 *
 * IMPORTANT:
 * - These values are CASE-SENSITIVE
 * - They MUST align exactly with ENTITLEMENT_CATALOG keys
 * - Never accept free-form strings upstream
 */

export const LICENSE_TIERS = {
  CORE: "CORE",
  PRO: "PRO",
  ENTERPRISE: "ENTERPRISE",
} as const;

export type LicenseTier =
  typeof LICENSE_TIERS[keyof typeof LICENSE_TIERS];