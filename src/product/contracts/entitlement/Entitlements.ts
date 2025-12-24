/**
 * PUBLIC CONTRACT — COMMERCIAL ENFORCEMENT
 * Changing fields affects pricing and licensing
 */

/**
 * Entitlements
 * ============
 * Canonical feature gating contract.
 */
export interface Entitlements {
  executiveSummary: boolean;
  remediationPlan: boolean;
  findings: boolean;
  riskRollup: boolean;
  evidence: boolean;
  evidenceLinks: boolean;
  controlTraces: boolean;
  attestations: boolean;
  export: {
    pdf: boolean;
    json: boolean;
  };
}
