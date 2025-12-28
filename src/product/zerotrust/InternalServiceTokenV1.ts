export interface InternalServiceTokenV1 {
  serviceId: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}
