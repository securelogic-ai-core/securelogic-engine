import { generateKeyPairSync, sign, verify } from "crypto";

/**
 * Real Ed25519 keypair generator
 */
export function generateKeypair(): {
  publicKey: string;
  privateKey: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function normalizePayload(payload: string): Buffer {
  return Buffer.from(payload, "utf8");
}

export function signHash(
  hash: string,
  privateKey: any
): string {
  if (!privateKey) throw new Error("No key provided to sign");

  const sig = sign(null, normalizePayload(hash), privateKey);
  return sig.toString("base64");
}

export function verifySignatureBytes(
  hash: string,
  signatureBase64: string,
  publicKey: any
): boolean {
  const sig = Buffer.from(signatureBase64, "base64");
  return verify(null, normalizePayload(hash), publicKey, sig);
}
