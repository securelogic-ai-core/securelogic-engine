export interface IdentityBindingV1 {
  version: "identity-binding-v1";
  subjectId: string;
  publicKey: string;
  provider: "INTERNAL" | "OIDC" | "SAML";
  boundAt: string;
}
