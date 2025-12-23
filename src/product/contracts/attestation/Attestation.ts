/**
 * External Attestation — V1
 *
 * Signed third-party assertion about an audit result.
 * ENTERPRISE / REGULATOR CONTRACT
 */
export interface AttestationV1 {
  id: string;

  authority: {
    name: string;
    organization: string;
    credential?: string;
  };

  statement: string;

  signature: {
    algorithm: "rsa-sha256" | "ecdsa-sha256";
    value: string;
  };

  signedAt: string;
}
