import type { VerificationPolicy } from "./VerificationPolicy";

export const STRICT_POLICY: VerificationPolicy = {
  requireSignatures: true,
  minimumSignatures: 1,
  requireLineage: true,
  blockReplay: true
};

export const PERMISSIVE_POLICY: VerificationPolicy = {
  requireSignatures: false,
  minimumSignatures: 0,
  requireLineage: false,
  blockReplay: false
};
