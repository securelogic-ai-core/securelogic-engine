import type { Entitlements } from "../contracts/entitlement/Entitlements";
import type { LicenseTier } from "../contracts/LicenseTier";

export const ENTITLEMENT_CATALOG: Record<LicenseTier, Entitlements> = {
  CORE: {
    executiveSummary: true,
    remediationPlan: false,
    findings: true,
    riskRollup: true,
    evidence: false,
    evidenceLinks: false,
    controlTraces: false,
    attestations: false,
    export: { pdf: false, json: false }
  },

  PRO: {
    executiveSummary: true,
    remediationPlan: true,
    findings: true,
    riskRollup: true,
    evidence: true,
    evidenceLinks: true,
    controlTraces: true,
    attestations: false,
    export: { pdf: true, json: true }
  },

  ENTERPRISE: {
    executiveSummary: true,
    remediationPlan: true,
    findings: true,
    riskRollup: true,
    evidence: true,
    evidenceLinks: true,
    controlTraces: true,
    attestations: true,
    export: { pdf: true, json: true }
  }
};
