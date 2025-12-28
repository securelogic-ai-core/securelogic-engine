import type { PolicyRule } from "./PolicyRule";

export const requireAttestation: PolicyRule = {
  id: "REQUIRE_ATTESTATION",
  evaluate: ctx => (ctx.attestationCount > 0 ? "ALLOW" : "DENY")
};

export const requireSignature: PolicyRule = {
  id: "REQUIRE_SIGNATURE",
  evaluate: ctx => (ctx.signatureCount > 0 ? "ALLOW" : "DENY")
};

export const defaultEnterprisePolicies: PolicyRule[] = [
  requireAttestation,
  requireSignature
];
