export const APPROVED_SIGNATURE_ALGORITHMS = ["ed25519"] as const;
export type ApprovedSignatureAlgorithm =
  typeof APPROVED_SIGNATURE_ALGORITHMS[number];
