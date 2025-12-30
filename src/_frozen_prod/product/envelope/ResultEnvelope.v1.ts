export interface ResultEnvelopeV1 {
  version: "v1";
  payload: unknown;
  payloadHash: string;
  signatures: {
    value: string;
    algorithm: "ed25519";
  }[];
  policy?: {
    licenseTier: "CORE" | "PRO";
    issuedForTenant: string;
    requestedCapabilities?: string[];
    allowedCapabilities?: string[];
  };
}
