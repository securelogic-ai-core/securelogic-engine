export interface EnterpriseConfig {
  environment: "dev" | "staging" | "prod";
  strictMode: true;
  allowUnsignedEnvelopes: false;
  requireAttestations: true;
  minAttestations: number;
  auditLogging: true;
  revocationEnforced: true;
  policyEnforced: true;
}
