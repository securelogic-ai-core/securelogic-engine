import sodium from "libsodium-wrappers";
import { canonicalHash } from "./canonicalHash.js";
import type { ExecutionRecord } from "./ExecutionRecord.js";

function signingView(execution: ExecutionRecord) {
  const { signatures, ...rest } = execution;
  return rest;
}

export async function generateKeypair() {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: Buffer.from(kp.publicKey).toString("base64"),
    privateKey: Buffer.from(kp.privateKey).toString("base64"),
  };
}

export async function signExecution(
  execution: ExecutionRecord,
  privateKeyBase64: string
): Promise<string> {
  await sodium.ready;

  const privateKey = Buffer.from(privateKeyBase64, "base64");
  const messageHash = canonicalHash(signingView(execution));
  const message = Buffer.from(messageHash, "hex");

  const sig = sodium.crypto_sign_detached(message, privateKey);
  return Buffer.from(sig).toString("base64");
}

export async function verifyExecutionSignature(
  execution: ExecutionRecord,
  signatureBase64: string,
  publicKeyBase64: string
): Promise<boolean> {
  await sodium.ready;

  const publicKey = Buffer.from(publicKeyBase64, "base64");
  const signature = Buffer.from(signatureBase64, "base64");
  const messageHash = canonicalHash(signingView(execution));
  const message = Buffer.from(messageHash, "hex");

  try { return sodium.crypto_sign_verify_detached(signature, message, publicKey); } catch { return false; }
}
