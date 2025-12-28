import type { ResultEnvelope } from "../contracts";

export interface ResultStore {
  save(result: ResultEnvelope): Promise<void>;
  get(envelopeId: string): Promise<ResultEnvelope | null>;
}
