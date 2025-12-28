export function createResultEnvelopeV1(payload: any) {
  return {
    version: "v1",
    payload,
    issuedAt: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    signatures: []
  };
}
