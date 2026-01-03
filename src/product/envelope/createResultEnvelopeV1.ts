export type ResultEnvelope = {
  version: "v1";
  createdAt: string;
  result: unknown;
};

export function createResultEnvelopeV1(result: unknown): ResultEnvelope {
  return {
    version: "v1",
    result,
    createdAt: new Date().toISOString()
  };
}
