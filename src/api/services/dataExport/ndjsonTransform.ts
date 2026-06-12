/**
 * ndjsonTransform.ts — object-mode → newline-delimited JSON (Decision Q9).
 *
 * Data files in the export bundle are NDJSON: one complete JSON row object per
 * line, no enclosing array. That is what lets the bundle generator (PR #2b) pipe
 * a `RowStreamer` straight into a zip entry a row at a time without buffering a
 * whole table. The manifest stays plain JSON.
 */

import { Transform } from "node:stream";

/**
 * Serialize one row to a single NDJSON line (JSON object + trailing `\n`).
 * Exposed as a pure function so the encoding can be unit-tested without a stream
 * and reused by array-backed callers.
 *
 * `JSON.stringify` returns `undefined` only for inputs like a bare `undefined` or
 * a function — never for a query row object — but we guard so a bad input throws
 * loudly here rather than emitting the literal string `"undefined\n"`.
 */
export function rowToNdjsonLine(row: unknown): string {
  const json = JSON.stringify(row);
  if (json === undefined) {
    throw new TypeError("rowToNdjsonLine: value is not JSON-serializable");
  }
  return json + "\n";
}

/**
 * A `Transform` that consumes row objects (object mode in) and produces UTF-8
 * NDJSON bytes (binary out). Drop a `RowStreamer`'s rows through this into any
 * writable sink (a zip entry, a file, a buffer).
 */
export function createNdjsonTransform(): Transform {
  return new Transform({
    writableObjectMode: true,
    readableObjectMode: false,
    transform(chunk, _encoding, callback) {
      try {
        callback(null, rowToNdjsonLine(chunk));
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}
