import type { EnterpriseConfig } from "./EnterpriseConfig";

export const DEFAULT_ENTERPRISE_CONFIG: EnterpriseConfig = {
  environment: "prod",
  strictMode: true,
  allowUnsignedEnvelopes: false,
  requireAttestations: true,
  minAttestations: 1,
  auditLogging: true,
  revocationEnforced: true,
  policyEnforced: true
};
