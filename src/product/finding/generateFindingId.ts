import { createHash } from "crypto";

/**
 * Deterministically generates a finding ID
 */
export function generateFindingId(
  controlId: string,
  severity: string
): string {
  const input = `${controlId}:${severity}`;
  return createHash("sha256")
    .update(input)
    .digest("hex")
    .slice(0, 16);
}
