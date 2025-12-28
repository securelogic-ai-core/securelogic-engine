import { assertApprovedAlgorithm } from "../policy/assertApprovedAlgorithm";

export interface KeyProvider {
  getPublicKey(): Uint8Array;
  getAlgorithm(): string;
}

export function validateKeyProvider(provider: KeyProvider): void {
  const alg = provider.getAlgorithm();
  assertApprovedAlgorithm(alg);
}
