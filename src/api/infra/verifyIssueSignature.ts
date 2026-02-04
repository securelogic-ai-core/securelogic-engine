import { createPublicKey, verify } from "crypto";

function loadIssuePublicKeyPem(): string | null {
  // Option A: direct PEM in env
  const pem = process.env.ISSUE_PUBLIC_KEY_PEM;
  if (pem && pem.trim().length > 0) return pem;

  // Option B: base64-encoded PEM in env (common for Render)
  const b64 = process.env.ISSUE_PUBLIC_KEY_PEM_B64;
  if (b64 && b64.trim().length > 0) {
    try {
      return Buffer.from(b64, "base64").toString("utf8");
    } catch {
      return null;
    }
  }

  // Option C: file path to PEM (if you mount it / bake it in)
  const filePath = process.env.ISSUE_PUBLIC_KEY_PATH;
  if (filePath && filePath.trim().length > 0) {
    try {
      // dynamic import to avoid bundler issues; Node runtime only
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("fs") as typeof import("fs");
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Verify the signed issue payload using RSA/ECDSA public key.
 * Fail closed: if the public key is missing/unreadable, return false.
 */
export function verifyIssueSignature(issue: unknown, signatureB64: string): boolean {
  const pem = loadIssuePublicKeyPem();
  if (!pem) return false;

  let sig: Buffer;
  try {
    sig = Buffer.from(signatureB64, "base64");
  } catch {
    return false;
  }

  // Your signing code likely uses canonical JSON.
  // If you already canonicalize elsewhere, keep it consistent.
  const payload = Buffer.from(JSON.stringify(issue), "utf8");

  try {
    const key = createPublicKey(pem);
    return verify("sha256", payload, key, sig);
  } catch {
    return false;
  }
}