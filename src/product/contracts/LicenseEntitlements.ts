import type { LicenseTier } from "./LicenseTier";
import type { Entitlements } from "./Entitlements";

export const LICENSE_ENTITLEMENTS: Record<LicenseTier, Entitlements> = {
  BASIC: {
    scoring: true,
    domainBreakdown: false,
    executiveNarrative: false,
    remediationPlan: false,
    exportPdf: false
  },
  PRO: {
    scoring: true,
    domainBreakdown: true,
    executiveNarrative: false,
    remediationPlan: false,
    exportPdf: false
  },
  ENTERPRISE: {
    scoring: true,
    domainBreakdown: true,
    executiveNarrative: true,
    remediationPlan: true,
    exportPdf: true
  }
};
