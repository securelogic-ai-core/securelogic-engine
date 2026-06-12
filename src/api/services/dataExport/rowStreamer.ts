/**
 * rowStreamer.ts — the cursor/array `RowStreamer` abstraction (Decision Q10).
 *
 * Production uses `CursorRowStreamer`, a thin wrapper over `pg-cursor` so an
 * arbitrarily large table streams a batch at a time instead of buffering the
 * whole result set. Tests use `ArrayRowStreamer`, which replays a fixed array
 * with identical batching semantics and needs no database.
 *
 * Consumption happens INSIDE a `withTenant(orgId)` callback (Decision Q1): the
 * caller opens a streamer, drains it, and closes it before the tenant scope
 * returns — the streamer never outlives the connection it rode in on.
 */

import Cursor from "pg-cursor";
import type { PoolClient } from "pg";
import type { RowStreamer } from "./types.js";

/**
 * Cursor-backed streamer. Construct it with a checked-out `PoolClient` and a
 * parameterized query; under `withTenant` that client is the tenant-scoped
 * savepoint client, so RLS / `app.current_org_id` apply to the cursor's reads.
 *
 * `read` resolves up to `batchSize` rows (`[]` at exhaustion). `close` releases
 * the server-side portal and is safe to call more than once; it does NOT release
 * the `PoolClient` — the owner of the connection (the `withTenant` wrapper) does.
 */
export class CursorRowStreamer<T = Record<string, unknown>> implements RowStreamer<T> {
  private readonly cursor: Cursor<T>;
  private closed = false;

  constructor(client: PoolClient, text: string, values: unknown[] = []) {
    // `client.query(submittable)` returns the same Cursor instance (pg's
    // Submittable overload); we keep our own reference for read/close.
    this.cursor = new Cursor<T>(text, values);
    client.query(this.cursor);
  }

  async read(batchSize: number): Promise<T[]> {
    if (this.closed) return [];
    if (batchSize <= 0) {
      throw new RangeError(`RowStreamer.read batchSize must be > 0, got ${batchSize}`);
    }
    return this.cursor.read(batchSize);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.cursor.close();
  }
}

/**
 * Array-backed streamer for tests. Replays `rows` in `batchSize` slices with the
 * same exhaustion + idempotent-close contract as `CursorRowStreamer`.
 */
export class ArrayRowStreamer<T = Record<string, unknown>> implements RowStreamer<T> {
  private index = 0;
  private closed = false;

  constructor(private readonly rows: readonly T[]) {}

  async read(batchSize: number): Promise<T[]> {
    if (this.closed) return [];
    if (batchSize <= 0) {
      throw new RangeError(`RowStreamer.read batchSize must be > 0, got ${batchSize}`);
    }
    const slice = this.rows.slice(this.index, this.index + batchSize);
    this.index += slice.length;
    return [...slice];
  }

  async close(): Promise<void> {
    this.closed = true;
    this.index = this.rows.length;
  }
}

/**
 * Drain a streamer to exhaustion, invoking `onRow` for each row in order. A
 * convenience for callers that do not need manual batch control; the production
 * bundle generator (PR #2b) pipes the streamer through the NDJSON transform
 * instead. Always closes the streamer, even on error.
 */
export async function drainRows<T>(
  streamer: RowStreamer<T>,
  onRow: (row: T) => void | Promise<void>,
  batchSize = 500,
): Promise<number> {
  let total = 0;
  try {
    for (;;) {
      const batch = await streamer.read(batchSize);
      if (batch.length === 0) break;
      for (const row of batch) {
        await onRow(row);
        total += 1;
      }
    }
  } finally {
    await streamer.close();
  }
  return total;
}
