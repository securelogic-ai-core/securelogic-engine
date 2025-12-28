export interface EncryptionPolicy {
  algorithm: "aes-256-gcm";
  keyProvider: "local" | "hsm";
  enforced: true;
}
