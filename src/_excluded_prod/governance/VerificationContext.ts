import type { EnterpriseConfig } from "../config/EnterpriseConfig";

export interface VerificationContext {
  config: EnterpriseConfig;
  verifierId: string;
  requestId: string;
}
