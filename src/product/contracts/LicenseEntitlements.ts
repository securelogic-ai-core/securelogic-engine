import type { LicenseTier } from "./LicenseTier";

/**
 * License Entitlements
 * Defines exactly what each tier can access.
 */
export const LICENSE_ENTITLEMENTS: Record<
  LicenseTier,
  {
    scoring: boolean;
    domainBreakdown: boolean;
    executiveNarrative: boolean;
    remediationPlan: boolean;
    exportPdf: boolean;
  }
> = {
  free: {
    scoring: true,
    domainBreakdown: false,
    executiveNarrative: false,
    remediationPlan: false,
    exportPdf: false
  },
  starter: {
    scoring: true,
    domainBreakdown: true,
    executiveNarrative: false,
    remediationPlan: false,
    exportPdf: false
  },
  professional: {
    scoring: true,
    domainBreakdown: true,
    executiveNarrative: true,
    remediationPlan: true,
    exportPdf: true
  },
  enterprise: {
    scoring: true,
    domainBreakdown: true,
    executiveNarrative: true,
    remediationPlan: true,
    exportPdf: true
  }
};
