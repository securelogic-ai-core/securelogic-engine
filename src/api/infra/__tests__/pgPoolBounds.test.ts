/**
 * pgPoolBounds.test.ts — PLATFORM-R1 item R1-1, the defect and the fix on a
 * REAL node-postgres Pool (DB-free: the pool's `Client` is injected, so the
 * queueing, timeout and counter logic under test is pg-pool's own, not a mock
 * of it).
 *
 *   1. THE DEFECT — with pg's default `connectionTimeoutMillis: 0`, a second
 *      `connect()` against a saturated pool never settles. The test bounds
 *      the wait at 1.5 s and shows the promise is still pending; without the
 *      bound it would hang the suite.
 *   2. THE FIX — with the resolved tuning applied, the same call rejects
 *      quickly with pg's own "timeout exceeded when trying to connect".
 *   3. The occupancy counters the saturation hook and /ops/health read
 *      (`waitingCount`) are non-zero exactly while a caller is queued.
 */

import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { Pool } from "pg";
import { resolvePoolTuning, toPoolOptions } from "../pgPoolTuning.js";

/** A client that "connects" instantly and never touches a socket. */
class FakeClient extends EventEmitter {
  // pg-pool discards a released client whose `_queryable` is falsy (the
  // real Client sets it on connect); without it idleCount can never be > 0.
  _queryable = true;
  connect(cb: (err?: Error) => void): void {
    setImmediate(() => cb());
  }
  query(): Promise<{ rows: unknown[] }> {
    return Promise.resolve({ rows: [] });
  }
  end(cb?: () => void): void {
    cb?.();
  }
}

const PENDING = Symbol("pending");
function settledWithin<T>(p: Promise<T>, ms: number): Promise<T | typeof PENDING> {
  return Promise.race([
    p,
    new Promise<typeof PENDING>((resolve) => setTimeout(() => resolve(PENDING), ms).unref())
  ]);
}

function makePool(extra: Record<string, unknown>): Pool {
  return new Pool({
    max: 1,
    ...extra,
    // pg-pool honours `options.Client` over the bound default; not in @types/pg.
    Client: FakeClient
  } as never);
}

describe("R1-1 — pool exhaustion on a real pg Pool", () => {
  it("DEFECT: with pg's default connectionTimeoutMillis (0) a saturated pool hangs forever", async () => {
    const pool = makePool({ connectionTimeoutMillis: 0 });
    const held = await pool.connect();
    const second = pool.connect();
    const outcome = await settledWithin(second, 1_500);
    expect(outcome).toBe(PENDING);
    expect(pool.waitingCount).toBe(1);
    held.release();
    (await second).release();
    await pool.end();
  }, 5_000);

  it("FIX: with the resolved tuning the same call fails fast with pg's timeout error", async () => {
    const tuning = resolvePoolTuning("app", { DATABASE_CONNECTION_TIMEOUT_MS: "250" });
    const pool = makePool({ ...toPoolOptions(tuning), max: 1 });
    const held = await pool.connect();
    const started = Date.now();
    await expect(pool.connect()).rejects.toThrow(/timeout exceeded when trying to connect/);
    expect(Date.now() - started).toBeLessThan(1_500);
    held.release();
    await pool.end();
  }, 5_000);

  it("exposes saturation through waitingCount, which returns to 0 once the client is released", async () => {
    const pool = makePool(toPoolOptions(resolvePoolTuning("app", {})));
    // resolved tuning sets max 8; force saturation with a single client
    const single = makePool({ ...toPoolOptions(resolvePoolTuning("app", {})), max: 1 });
    await pool.end();
    const held = await single.connect();
    const second = single.connect();
    expect(single.waitingCount).toBe(1);
    expect(single.totalCount).toBe(1);
    expect(single.idleCount).toBe(0);
    held.release();
    (await second).release();
    expect(single.waitingCount).toBe(0);
    expect(single.idleCount).toBe(1);
    await single.end();
  });

  it("sends statement_timeout as a startup parameter and omits it when disabled", () => {
    expect(toPoolOptions(resolvePoolTuning("app", {})).statement_timeout).toBe(30_000);
    expect(toPoolOptions(resolvePoolTuning("elevated", {})).statement_timeout).toBe(120_000);
    expect(
      toPoolOptions(resolvePoolTuning("app", { DATABASE_STATEMENT_TIMEOUT_MS: "0" })).statement_timeout
    ).toBe(false);
    expect(
      toPoolOptions(resolvePoolTuning("elevated", { DATABASE_ELEVATED_STATEMENT_TIMEOUT_MS: "0" }))
        .statement_timeout
    ).toBe(false);
    // The two statement keys are independent, like the two max keys.
    const t = resolvePoolTuning("elevated", { DATABASE_STATEMENT_TIMEOUT_MS: "1000" });
    expect(t.statementTimeoutMillis).toBe(120_000);
  });
});
