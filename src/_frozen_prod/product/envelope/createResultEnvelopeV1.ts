export function createResultEnvelopeV1(payload: any) {
  return {
    version: "v1",
    payload,
    issuedAt: new Date().toISOString(),
    signature: null,
    nonce: Math.random().toString(36).slice(2),
  };
}
