import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Issue } from "../contracts/issue.schema.js";

const PUBLIC_KEY_PATH = path.resolve("keys/issue.public.pem");

let cachedPublicKey: string | null = null;

function getPublicKey(): string {
  if (cachedPublicKey) return cachedPublicKey;

  if (!fs.existsSync(PUBLIC_KEY_PATH)) {
    throw new Error("issue_public_key_missing");
  }

  cachedPublicKey = fs.readFileSync(PUBLIC_KEY_PATH, "utf-8");
  return cachedPublicKey;
}

export function verifyIssueSignature(
  issue: Issue,
  signature: string
): boolean {
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(JSON.stringify(issue));
    verifier.end();

    return verifier.verify(getPublicKey(), signature, "base64");
  } catch {
    return false;
  }
}