import { decryptField } from "./fieldEncryption.js";

/**
 * Decrypt and parse content_json from the intelligence_briefs row.
 *
 * Handles two on-disk shapes:
 *   - Encrypted: JSONB value is a JSON string holding the encryptField output.
 *     The manual POST /api/intelligence-briefs/generate route writes this shape.
 *   - Plaintext object: legacy and scheduler-written rows store the JSON
 *     object directly. The scheduler does not encrypt content_json today.
 *
 * Returns null on any failure (decrypt failure, parse failure, unexpected
 * shape) so callers can degrade gracefully — used by both the brief detail
 * route and prior-brief context lookup for synthesis calibration.
 */
export function parseContentJson(
  value: unknown
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(decryptField(value)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}
