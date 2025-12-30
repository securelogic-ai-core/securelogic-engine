export interface EnvelopePolicy {
  licenseTier: "CORE" | "PRO";
  issuedForTenant: string;
  requestedCapabilities?: string[];
  allowedCapabilities?: string[];

  payloadHash: string;
  signature: string;
}
