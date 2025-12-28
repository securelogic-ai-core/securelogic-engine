/**
 * Product Entitlements — V1
 *
 * DEFINES what a customer is allowed to receive.
 * Pricing, SKUs, and enforcement depend on this contract.
 *
 * ENTERPRISE COMMERCIAL CONTRACT
 */

export interface ProductEntitlementsV1 {
  executiveSummary: boolean;
  findings: boolean;
  riskRollup: boolean;
  remediationPlan: boolean;

  evidence: boolean;
  controlTraces: boolean;
  attestations: boolean;

  export: {
    pdf: boolean;
    json: boolean;
  };
}
