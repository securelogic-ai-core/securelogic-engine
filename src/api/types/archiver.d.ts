/**
 * Ambient type shim for `archiver` (the published `@types/archiver@8` is for a
 * different major than the `archiver@7` runtime we depend on — its default
 * callable export was dropped, so `import archiver from "archiver"` fails to
 * resolve). Same approach as src/api/types/pg-cursor.d.ts: declare only the
 * surface the export engine uses, with the real `export =` callable shape.
 *
 * Targets upstream `archiver@7.x`. The runtime module is `module.exports =
 * function vending(format, options) { ... }` returning an Archiver (a
 * Transform stream); `append`/`pipe`/`finalize`/`abort` and the
 * `entry`/`warning`/`error` events are the only members we touch. `finalize()`
 * returns a Promise in archiver 5+. If `archiver` is upgraded, re-verify this
 * surface against the new dist.
 */
declare module "archiver" {
  interface EntryData {
    name: string;
  }

  interface ArchiverOptions {
    zlib?: { level?: number };
  }

  interface Archiver {
    /** Append a source (stream/buffer/string) as a named entry. */
    append(source: NodeJS.ReadableStream | Buffer | string, data: { name: string }): this;
    /** Pipe the zip output to a writable sink; returns the sink. */
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
    /** Finish the archive; resolves once all entries are written (archiver 5+). */
    finalize(): Promise<void>;
    /** Abort the archive, destroying the output. */
    abort(): this;
    on(event: "entry", listener: (entry: EntryData) => void): this;
    on(event: "error" | "warning", listener: (error: Error & { code?: string }) => void): this;
    on(event: "progress" | "close" | "end" | "drain" | "finish", listener: (...args: unknown[]) => void): this;
    off(event: "entry", listener: (entry: EntryData) => void): this;
  }

  function archiver(format: "zip" | "tar", options?: ArchiverOptions): Archiver;

  export = archiver;
}
