import crypto from "crypto";

/**
 * Produce a canonical JSON string with stable key ordering
 * so hashes are deterministic across runs and machines.
 */
export function canonicalize(obj: unknown): string {
  return JSON.stringify(sortObject(obj));
}

function sortObject(value: any): any {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, key: string) => {
        acc[key] = sortObject(value[key]);
        return acc;
      }, {});
  }

  return value;
}

/**
 * Hash a string using SHA-256
 */
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
