import crypto from "crypto";

export function hashPolicyBundle(bundle: any): string {
  // Stable stringify: remove volatile fields
  const clone = { ...bundle };
  delete clone.createdAt;
  delete clone.bundleHash;

  const json = JSON.stringify(clone, Object.keys(clone).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}
