import type { ProductTier } from "../ProductTier";

/**
 * ENTITLEMENT MATRIX — V1
 * ----------------------
 * This file defines what each tier is ALLOWED to receive.
 * Sales, Legal, and Engineering must align to this.
 */
export interface Entitlements {
  executiveSummary: boolean;
  findings: boolean;
  remediationPlan: boolean;
  controlTraces: boolean;
  evidence: boolean;
  riskRollup: boolean;
  attestations: boolean;
  verification: boolean;
}

export const ENTITLEMENT_MATRIX: Record<ProductTier, Entitlements> = {
  Community: {
    executiveSummary: true,
    findings: false,
    remediationPlan: false,
    controlTraces: false,
    evidence: false,
    riskRollup: false,
    attestations: false,
    verification: false
  },

  Professional: {
    executiveSummary: true,
    findings: true,
    remediationPlan: true,
    controlTraces: false,
    evidence: true,
    riskRollup: true,
    attestations: false,
    verification: false
  },

  Enterprise: {
    executiveSummary: true,
    findings: true,
    remediationPlan: true,
    controlTraces: true,
    evidence: true,
    riskRollup: true,
    attestations: true,
    verification: true
  },

  Regulated: {
    executiveSummary: true,
    findings: true,
    remediationPlan: true,
    controlTraces: true,
    evidence: true,
    riskRollup: true,
    attestations: true,
    verification: true
  }
};
