export interface PolicyContextV1 {
  envelopeId: string;
  consumerId?: string;
  trustLevel: number;
  attestationCount: number;
  signatureCount: number;
  verifiedAt: string;
}
