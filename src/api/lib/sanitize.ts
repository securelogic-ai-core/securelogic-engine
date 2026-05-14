/**
 * sanitize.ts — Application-layer input sanitization utilities.
 *
 * These helpers are applied in validation functions before any field
 * reaches the database. They are intentionally simple and side-effect-free.
 *
 * sanitizeString(value, maxLength)
 *   1. Strips null bytes (\x00) — prevents null-byte injection in
 *      downstream string operations and certain DB drivers.
 *   2. Truncates to maxLength bytes — defence-in-depth cap so a
 *      misbehaving client cannot send arbitrarily large strings even
 *      if the body-size limit is not breached.
 *
 * Usage:
 *   import { sanitizeString } from "../lib/sanitize.js";
 *   const title = sanitizeString(rawTitle, 255);
 */

/**
 * Strip null bytes and truncate a string to a maximum length.
 *
 * @param value     - The raw input string (already known to be a string).
 * @param maxLength - Maximum number of characters to retain.
 * @returns The sanitized, possibly truncated string.
 */
export function sanitizeString(value: string, maxLength: number): string {
  // Strip null bytes — PostgreSQL rejects strings with \x00 in TEXT columns.
  const stripped = value.replace(/\x00/g, "");
  // Truncate at the application layer before reaching the DB.
  return stripped.length > maxLength ? stripped.slice(0, maxLength) : stripped;
}
