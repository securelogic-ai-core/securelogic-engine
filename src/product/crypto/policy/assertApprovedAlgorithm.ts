import {
  APPROVED_SIGNATURE_ALGORITHMS,
  ApprovedSignatureAlgorithm
} from "./ApprovedAlgorithms";

export function assertApprovedAlgorithm(
  alg: string
): asserts alg is ApprovedSignatureAlgorithm {
  if (!APPROVED_SIGNATURE_ALGORITHMS.includes(alg as ApprovedSignatureAlgorithm)) {
    throw new Error(`UNAPPROVED_CRYPTO_ALGORITHM:${alg}`);
  }
}
