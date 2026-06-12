/**
 * Ambient type shim for `pg-cursor` (no `@types/pg-cursor` is published).
 *
 * Targets upstream `pg-cursor@2.20.0`. Only the surface the export engine uses is
 * declared: construction, the promise form of `read(rowCount)`, and `close()`.
 * In 2.x both `read` and `close` return a Promise when called WITHOUT a callback
 * (verified in node_modules/pg-cursor/index.js: `read(rows, cb)` / `close(cb)`
 * resolve via an internal Promise when `cb` is omitted).
 *
 * A `Cursor` is a pg `Submittable`: the idiom is
 * `const cursor = client.query(new Cursor(text, values))`. We expose `submit`
 * structurally so that overload of `PoolClient.query` resolves, without pulling
 * in pg's internal `Connection` type.
 *
 * If `pg-cursor` is upgraded, re-verify this signature against the new
 * index.js (esp. that the no-callback `read`/`close` promise form survives).
 */
declare module "pg-cursor" {
  class Cursor<R = Record<string, unknown>> {
    constructor(text: string, values?: unknown[], config?: { rowMode?: "array" });
    /** pg `Submittable` hook — invoked by `client.query(cursor)`. */
    submit(connection: unknown): void;
    /** Read up to `rowCount` rows; resolves `[]` once the cursor is exhausted. */
    read(rowCount: number): Promise<R[]>;
    /** Release the cursor's server-side portal. Idempotent once done. */
    close(): Promise<void>;
  }
  export = Cursor;
}
