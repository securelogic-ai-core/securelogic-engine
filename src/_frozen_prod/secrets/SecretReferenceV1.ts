export interface SecretReferenceV1 {
  secretId: string;
  provider: "vault" | "kms";
}
