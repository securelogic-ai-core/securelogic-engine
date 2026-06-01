/**
 * tenantContext.ts — A04-G1 phase 1, step 2 (PR 1 of N: wrapper only).
 *
 * Pure, pool-free tenant-context plumbing. This module deliberately
 * instantiates NO connection pool and reads NO environment variable, so it can
 * be unit-tested without a live Postgres and without tripping the
 * `DATABASE_URL is not set` throw in postgres.ts. The pools and the public
 * `pg` / `pgElevated` handles live in postgres.ts, which wires the primitives
 * exported here.
 *
 * ── The model (Decision A1 + B1, see docs/A04-G1-rls-rollout-plan.md) ───────
 *
 *   withTenant(orgId, fn): checks out a client, opens ONE transaction, runs
 *     `SET LOCAL app.current_org_id = orgId`, and runs fn inside an
 *     AsyncLocalStorage scope carrying that client. The transaction boundary
 *     IS the tenant boundary. RLS policies (added in later phases) read
 *     current_setting('app.current_org_id').
 *
 *   The exported `pg` wrapper routes `.query()` to the ALS client when a scope
 *     is active, else falls back to the raw pool. This makes the ~358
 *     pre-existing `pg.query(...)` call sites tenant-scoped for free, with
 *     ZERO behavioural change until a withTenant scope is actually entered.
 *
 *   The ~57 explicit-transaction call sites use `pg.connect()` then issue
 *     BEGIN/COMMIT/ROLLBACK on the returned client. Inside a withTenant scope
 *     the request is ALREADY in a transaction, so those statements are
 *     rewritten to SAVEPOINT / RELEASE / ROLLBACK-TO by `createSavepointClient`
 *     and `.release()` becomes a no-op (the withTenant owner releases the real
 *     client). Outside a scope, `pg.connect()` returns a real pool client
 *     unchanged.
 *
 *   withElevated(fn): for code that legitimately spans tenants (ingestion
 *     workers, authAnomaly cross-org reads, signup org-INSERT, the admin
 *     operator surface). Runs against the owner pool OUTSIDE any tenant scope.
 *
 * ── Fail-fast ───────────────────────────────────────────────────────────────
 *
 *   The transparent `pg.query()` fallback to the raw pool is the ONLY
 *   sanctioned silent-fallback path (it preserves today's behaviour for
 *   pre-existing call sites). Code that EXPLICITLY requires tenant scope must
 *   call `requireTenantContext()`, which throws if no scope is active rather
 *   than silently running unscoped.
 *
 * ── Escape hatch ─────────────────────────────────────────────────────────────
 *
 *   If the savepoint proxy ever does not fit a call site — e.g. it needs
 *   BEGIN with an explicit ISOLATION LEVEL, advisory locks, LISTEN/NOTIFY,
 *   COPY, or it wants to manage its own transaction lifecycle — that call site
 *   should bypass the proxy entirely: check out a client from the unwrapped
 *   `pgRaw` pool (exported by postgres.ts), set its own
 *   `SELECT set_config('app.current_org_id', $1, true)` after BEGIN using
 *   `requireTenantContext().orgId`, and own its own BEGIN/COMMIT/ROLLBACK.
 *   `pgRaw` performs NO routing and NO statement rewriting.
 *
 * NOTE: As of PR 1 nothing calls withTenant/withElevated and no middleware
 * enters a scope, so `tenantStorage.getStore()` is always undefined in
 * production — the wrapper is byte-identical to the previous raw pool.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient, QueryResult } from "pg";

export interface TenantContext {
  /** The request/iteration-scoped client. Transaction is already open and the GUC is set. */
  readonly client: PoolClient;
  /** The tenant whose rows this scope may touch. */
  readonly orgId: string;
  /**
   * Monotonic, scope-wide savepoint counter. Shared across every
   * createSavepointClient() in the same scope so savepoint names are globally
   * unique even when explicit-transaction blocks nest.
   */
  readonly savepoint: { n: number };
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/** The active tenant scope, or undefined when none is in scope. */
export function currentTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

/**
 * Fail-fast accessor. Use when a code path MUST be tenant-scoped. Throws if
 * called outside a withTenant scope rather than letting a query run unscoped.
 */
export function requireTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error(
      "requireTenantContext: no tenant context in scope. This path expects to " +
        "run inside withTenant(orgId, ...). If it legitimately spans orgs, use " +
        "withElevated() instead."
    );
  }
  return ctx;
}

const EMPTY_RESULT: QueryResult = {
  command: "",
  rowCount: 0,
  oid: 0,
  fields: [],
  rows: []
};

type TxControl = "BEGIN" | "COMMIT" | "ROLLBACK";

/**
 * Returns the bare transaction-control keyword for a query argument, or null.
 * Only an exact, un-parameterised BEGIN/COMMIT/ROLLBACK counts; anything else
 * (including `BEGIN ISOLATION LEVEL ...`) returns null and passes through.
 */
function txControlKeyword(value: unknown): TxControl | null {
  if (typeof value !== "string") return null;
  const kw = value.trim().toUpperCase();
  if (kw === "BEGIN" || kw === "COMMIT" || kw === "ROLLBACK") return kw;
  return null;
}

/**
 * Wraps an already-checked-out, in-transaction client so legacy
 * explicit-transaction call sites nest safely inside the ambient request
 * transaction:
 *
 *   BEGIN     -> SAVEPOINT sp_n
 *   COMMIT    -> RELEASE SAVEPOINT sp_n
 *   ROLLBACK  -> ROLLBACK TO SAVEPOINT sp_n; RELEASE SAVEPOINT sp_n
 *   release() -> no-op (the withTenant owner releases the real client)
 *
 * Only the single-argument control-statement form is rewritten. Parameterised
 * queries, config objects carrying values, and cursors/streams (Submittable)
 * pass through untouched.
 */
export function createSavepointClient(ctx: TenantContext): PoolClient {
  const real = ctx.client;
  const stack: string[] = [];

  const query = (...args: unknown[]): unknown => {
    if (args.length === 1) {
      const first = args[0];
      const control =
        txControlKeyword(first) ??
        (typeof first === "object" && first !== null && "text" in first
          ? txControlKeyword((first as { text: unknown }).text)
          : null);

      if (control === "BEGIN") {
        const name = `sp_${++ctx.savepoint.n}`;
        stack.push(name);
        return real.query(`SAVEPOINT ${name}`);
      }
      if (control === "COMMIT") {
        const name = stack.pop();
        // Mismatched COMMIT: never commit the ambient request transaction.
        if (name === undefined) return Promise.resolve(EMPTY_RESULT);
        return real.query(`RELEASE SAVEPOINT ${name}`);
      }
      if (control === "ROLLBACK") {
        const name = stack.pop();
        if (name === undefined) return Promise.resolve(EMPTY_RESULT);
        return real
          .query(`ROLLBACK TO SAVEPOINT ${name}`)
          .then(() => real.query(`RELEASE SAVEPOINT ${name}`));
      }
    }
    return (real.query as (...a: unknown[]) => unknown)(...args);
  };

  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "query") return query;
      if (prop === "release") return () => { /* owned by withTenant */ };
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    }
  }) as PoolClient;
}
