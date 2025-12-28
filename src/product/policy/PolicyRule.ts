export type PolicyDecision = "ALLOW" | "DENY";

export interface PolicyContext {
  consumerId?: string;
  envelopeId: string;
  attestationCount: number;
  signatureCount: number;
  verifiedAt: string;
}

export interface PolicyRule {
  id: string;
  evaluate(ctx: PolicyContext): PolicyDecision;
}
