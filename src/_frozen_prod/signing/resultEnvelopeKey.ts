import crypto from "crypto";

const keypair = crypto.generateKeyPairSync("ed25519");

export function getEnvelopePrivateKey() {
  return keypair.privateKey;
}

export function getEnvelopePublicKey() {
  return keypair.publicKey;
}
