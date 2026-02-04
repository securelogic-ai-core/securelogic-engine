import crypto from "crypto";
import type { Issue } from "../contracts/issue.schema.js";

const PUBLIC_KEY = process.env.ISSUE_PUBLIC_KEY;

if (!PUBLIC_KEY) {
  throw new Error("ISSUE_PUBLIC_KEY is not set");
}

export function verifyIssueSignature(
  issue: Issue,
  signature: string
): boolean {
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(JSON.stringify(issue));
    verifier.end();

    return verifier.verify(PUBLIC_KEY, signature, "base64");
  } catch {
    return false;
  }
}