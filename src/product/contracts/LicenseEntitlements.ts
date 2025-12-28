import type { LicenseTier } from "./LicenseTier";
import type { LicenseTier } from "./LicenseTier";


/**
/**
 * License Entitlements
 * License Entitlements
 * Defines exactly what each tier can access.
 * Defines exactly what each tier can access.
 */
 */
export const LICENSE_ENTITLEMENTS: Record<
export const LICENSE_ENTITLEMENTS: Record<
  LicenseTier,
  LicenseTier,
  {
  {
    scoring: boolean;
    scoring: boolean;
    domainBreakdown: boolean;
    domainBreakdown: boolean;
    executiveNarrative: boolean;
    executiveNarrative: boolean;
    remediationPlan: boolean;
    remediationPlan: boolean;
    exportPdf: boolean;
    exportPdf: boolean;
  }
  }
> = {
> = {
    scoring: true,
    scoring: true,
    domainBreakdown: false,
    domainBreakdown: false,
    executiveNarrative: false,
    executiveNarrative: false,
    remediationPlan: false,
    remediationPlan: false,
    exportPdf: false
    exportPdf: false
  },
  },
  starter: {
  starter: {
    scoring: true,
    scoring: true,
    domainBreakdown: true,
    domainBreakdown: true,
    executiveNarrative: false,
    executiveNarrative: false,
    remediationPlan: false,
    remediationPlan: false,
    exportPdf: false
    exportPdf: false
  },
  },
  professional: {
  professional: {
    scoring: true,
    scoring: true,
    domainBreakdown: true,
    domainBreakdown: true,
    executiveNarrative: true,
    executiveNarrative: true,
    remediationPlan: true,
    remediationPlan: true,
    exportPdf: true
    exportPdf: true
  },
  },
  enterprise: {
  enterprise: {
    scoring: true,
    scoring: true,
    domainBreakdown: true,
    domainBreakdown: true,
    executiveNarrative: true,
    executiveNarrative: true,
    remediationPlan: true,
    remediationPlan: true,
    exportPdf: true
    exportPdf: true
  }
  }
};
};
