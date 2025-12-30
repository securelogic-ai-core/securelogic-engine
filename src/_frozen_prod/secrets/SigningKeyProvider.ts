import crypto from "crypto";

let keyPair: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject } | null = null;

export function getSigningKeyPair() {
  if (!keyPair) {
    keyPair = crypto.generateKeyPairSync("ed25519");
  }
  return keyPair;
}

export function getVerificationKey() {
  return getSigningKeyPair().publicKey;
}
