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

// ---------------------------------------------------------------------------
// stripHtmlToText — IQP Q1 (Phase 1 audit defect #3)
// ---------------------------------------------------------------------------

/** Named HTML entities that appear in RSS/Atom feed text. Numeric entities
 * (decimal + hex) are handled generically below. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“"
};

/**
 * Reduce feed/LLM markup to clean plain text for customer-facing intelligence
 * fields. This is the ONE sanitization truth of the intelligence pipeline
 * (IQP Q1): it runs at the canonical normalization boundaries only —
 * normalizeSignal (stored normalized_summary) and brief-item derivation from
 * raw provenance. Renderers keep their output ENCODING (escHtml/JSX) but never
 * sanitize or mutate content themselves.
 *
 * Steps, in order:
 *   1. Drop <script>/<style> elements INCLUDING their content.
 *   2. Replace every remaining tag with a space (so "a<br>b" → "a b").
 *   3. Decode entities — named (the feed-common set above), decimal (&#8217;),
 *      and hex (&#x27;). Single pass: double-encoded input (&amp;lt;) decodes
 *      one level, matching what the source visibly intended.
 *   4. Remove paired markdown emphasis markers (**bold**, __bold__), keeping
 *      the inner text. Conservative: unpaired markers are left untouched.
 *   5. Collapse whitespace runs and trim.
 *
 * Pure and idempotent on its own output. Plain text passes through unchanged
 * apart from whitespace collapsing.
 */
export function stripHtmlToText(value: string): string {
  let text = value
    // 1. script/style elements with their content
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    // 2. any remaining tag (incl. closing tags, comments' brackets, <br/>)
    .replace(/<[^>]*>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // 3. entities — named, then numeric decimal, then numeric hex
  text = text
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    });

  // 4. paired markdown emphasis markers, inner text kept
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1");

  // 5. whitespace collapse
  return text.replace(/\s+/g, " ").trim();
}
