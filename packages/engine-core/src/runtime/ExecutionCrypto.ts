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

/**
 * Signs a hash (canonical string)
 */
export function signHash(hash: string, privateKeyPem: string): string {
  if (!privateKeyPem) throw new Error("No key provided to sign");

  const sig = sign(null, normalizePayload(hash), privateKeyPem);
  return sig.toString("base64");
}

/**
 * Verifies a hash signature
 */
export function verifySignatureBytes(
  hash: string,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  const sig = Buffer.from(signatureBase64, "base64");
  return verify(null, normalizePayload(hash), publicKeyPem, sig);
}

/**
 * Legacy compatibility wrapper for tamper tests.
 * This signs ANY object by hashing it canonically first.
 * This is NOT used by the runtime engine.
 */
export async function signExecution(payload: any, privateKeyPem: string) {
  const { canonicalHash } = await import("./canonicalHash.js");
  const hash = canonicalHash(payload);
  const signature = signHash(hash, privateKeyPem);
  return { payload, signature };
}
