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

/** A side effect to run ONLY after the tenant transaction durably commits. */
export type AfterCommitCallback = () => void | Promise<void>;

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
  /**
   * Callbacks queued to run AFTER this transaction commits (post-commit side
   * effects — e.g. notifications that must never fire for a rolled-back write).
   * `withTenant` drains this ONLY on the COMMIT path; the rollback path discards
   * it untouched. Empty by default, so a scope that registers nothing is
   * byte-identical to before this hook existed.
   */
  readonly afterCommit: AfterCommitCallback[];
}

/**
 * Queue a side effect to run once the active tenant transaction COMMITS. The
 * canonical way to make a post-commit notification transactionally correct: the
 * callback fires only after a durable commit and is discarded on rollback, so a
 * write and its announcement can never disagree.
 *
 * Registered against the CURRENT tenant scope (the request/iteration transaction),
 * so it fires at the true commit boundary even when the caller sits inside a
 * savepoint. With no tenant scope in play there is no transaction to wait on, so
 * the callback runs immediately (best-effort, detached) — the honest equivalent of
 * "already committed". Never throws to the caller.
 */
export function registerAfterCommit(fn: AfterCommitCallback): void {
  const ctx = tenantStorage.getStore();
  if (ctx) {
    ctx.afterCommit.push(fn);
    return;
  }
  // No transaction to gate on — run detached, never surfacing an error.
  try {
    const p = fn();
    if (p && typeof (p as Promise<void>).then === "function") {
      (p as Promise<void>).catch(() => {});
    }
  } catch {
    /* swallow: a post-commit side effect must never break its caller */
  }
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/** The active tenant scope, or undefined when none is in scope. */
export function currentTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

/* ── Pre-tenant bootstrap exemption (#966, owner ruling 2026-09-03) ─────────
 *
 * A handful of queries run BEFORE the tenant is known, because resolving the
 * tenant is their purpose: the API-key hash lookup, the users row behind a
 * JWT-bridge session, the api_keys bookkeeping UPDATE, and the organizations
 * row that attachOrganizationContext exists to load. Every one is keyed by
 * primary key or by key hash, so none can return another tenant's rows.
 *
 * Before this exemption those six sites emitted `db_query_outside_tenant_scope`
 * on EVERY API-key request. That is a permanent false positive, and a tripwire
 * that always fires is a tripwire nobody reads — the exact failure mode the
 * signal exists to prevent, on a codebase where app-layer predicates are the
 * whole boundary for tables without RLS.
 *
 * THE EXEMPTION IS DELIBERATELY NARROW. It is NOT "raw-pool access is fine
 * when no tenant is in scope":
 *
 *   1. `reason` is a CLOSED allowlist. An arbitrary string throws. Adding a
 *      site means editing this list, in review, with a name that says why.
 *   2. It exempts `pg.query()` ONLY. A bare `pg.connect()` still warns even
 *      inside the scope — a bootstrap path that checks out a raw client is
 *      precisely what you would want to see.
 *   3. It covers only what the callback covers. Wrap the single query, never
 *      the surrounding handler, so anything added later is unexempt by default.
 *   4. `preTenantBootstrapOnly.test.ts` asserts the helper is imported by the
 *      two sanctioned middleware modules and nowhere else, so the exemption
 *      cannot spread by copy-paste.
 *
 * This supersedes the "not silenced in code" note that stood in postgres.ts:
 * the classification argument was right that these calls are correct, and
 * wrong that permanent WARN noise was the acceptable way to record it.
 */

/** The ONLY paths that may suppress the bare-query tripwire. Closed set. */
export const PRE_TENANT_BOOTSTRAP_REASONS = [
  /** requireApiKey: the users row behind a verified JWT, by primary key. */
  "api_key_auth.user_identity_lookup",
  /** requireApiKey: the org's active api_keys row, by organization_id from the verified JWT. */
  "api_key_auth.org_key_lookup",
  /** requireApiKey: the api_keys row behind a presented key, by key_hash. */
  "api_key_auth.key_hash_lookup",
  /** requireApiKey: fire-and-forget `last_used_at` bookkeeping, by primary key. */
  "api_key_auth.key_last_used_update",
  /** attachOrganizationContext: the organizations row this middleware exists to load, by primary key. */
  "org_context.entitlement_lookup",
] as const;

export type PreTenantBootstrapReason = (typeof PRE_TENANT_BOOTSTRAP_REASONS)[number];

const bootstrapStorage = new AsyncLocalStorage<PreTenantBootstrapReason>();

/** The active bootstrap reason, or undefined. Read by postgres.ts only. */
export function currentPreTenantBootstrap(): PreTenantBootstrapReason | undefined {
  return bootstrapStorage.getStore();
}

/**
 * Run ONE pre-tenant bootstrap query with the bare-query tripwire suppressed.
 *
 * Wrap the query, not the handler. An unlisted reason throws rather than
 * silently opening a new exemption.
 */
export function withPreTenantBootstrap<T>(
  reason: PreTenantBootstrapReason,
  fn: () => T
): T {
  if (!(PRE_TENANT_BOOTSTRAP_REASONS as readonly string[]).includes(reason)) {
    throw new Error(
      `withPreTenantBootstrap: '${reason}' is not an allowlisted pre-tenant ` +
        "bootstrap reason. Add it to PRE_TENANT_BOOTSTRAP_REASONS in review, " +
        "or use withTenant()/withElevated() — do not widen the exemption here."
    );
  }
  return bootstrapStorage.run(reason, fn);
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
 * A04-G1 PR γ.0 — savepoint-safety guard error.
 *
 * `createSavepointClient` rewrites ONLY the bare `BEGIN`/`COMMIT`/`ROLLBACK`
 * form into SAVEPOINT semantics (see `txControlKeyword`). Any other
 * transaction-control or session-level statement issued on the savepoint-
 * rewritten tenant client would execute UN-rewritten against the ambient
 * request transaction — a real nested BEGIN, a session lock that rides the
 * pooled connection back, an async-notify channel that leaks across reuse, a
 * COPY stream the proxy can't frame, or a SET TRANSACTION that mutates the
 * request transaction's isolation. The guard (below) throws this before any
 * such statement reaches the real client. See
 * docs/A04-G1-pr-gamma0-design.md §2.
 */
export class TenantWrapUnrewriteableStatementError extends Error {
  constructor(statement: string) {
    super(
      `asTenant wrap: statement "${statement}" cannot run on the savepoint-rewritten ` +
        `tenant client — createSavepointClient only rewrites the bare BEGIN/COMMIT/ROLLBACK ` +
        `form, so this would execute un-rewritten on the request transaction. If a connection ` +
        `legitimately needs this (explicit ISOLATION LEVEL, advisory lock, LISTEN/NOTIFY, COPY, ` +
        `bespoke tx lifecycle), use the pgRaw escape hatch with its own set_config — see ` +
        `tenantContext.ts:44-53.`
    );
    this.name = "TenantWrapUnrewriteableStatementError";
  }
}

/**
 * True when `kw` (an already-`trim().toUpperCase()`-normalised statement) is a
 * transaction-control / session-level statement that the savepoint rewriter
 * does NOT handle and therefore must not reach the tenant client. Bare
 * BEGIN/COMMIT/ROLLBACK are handled upstream by `txControlKeyword` and never
 * reach this check. Word-boundary / prefix-anchored so that ordinary SQL
 * carrying these tokens as data or column names (`SELECT 'BEGIN'`,
 * `... SET begin_at = ...`, `SET LOCAL app.current_org_id = ...`) does NOT match.
 * See docs/A04-G1-pr-gamma0-design.md §2.2.
 */
export function isUnrewriteableStatement(kw: string): boolean {
  // Non-bare transaction control (bare forms already rewritten upstream).
  if (/^BEGIN\b/.test(kw) && kw !== "BEGIN") return true;
  if (/^COMMIT\b/.test(kw) && kw !== "COMMIT") return true;
  if (/^ROLLBACK\b/.test(kw) && kw !== "ROLLBACK") return true;
  if (/^END\b/.test(kw)) return true; // COMMIT synonym, never rewritten
  if (/^START\s+TRANSACTION\b/.test(kw)) return true;
  // SET TRANSACTION / SET LOCAL TRANSACTION mutate the ambient tx (decision 1).
  // Anchored to `... TRANSACTION` so legit `SET LOCAL <guc> = ...` is untouched.
  if (/^SET\s+TRANSACTION\b/.test(kw)) return true;
  if (/^SET\s+LOCAL\s+TRANSACTION\b/.test(kw)) return true;
  // Advisory locks (session + xact + unlock + shared variants).
  if (/^SELECT\s+PG_ADVISORY_/.test(kw)) return true;
  if (/^(LISTEN|UNLISTEN|NOTIFY)\b/.test(kw)) return true;
  if (/^COPY\b/.test(kw)) return true;
  return false;
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
    // Candidate statement string — string form OR config-object { text } form
    // (mirrors the rewriter's text-branch below). Used by both the bare-control
    // rewrite and the γ.0 guard. null when args[0] is neither (cursor/Submittable).
    const first = args[0];
    const stmt: string | null =
      typeof first === "string"
        ? first
        : typeof first === "object" &&
            first !== null &&
            "text" in first &&
            typeof (first as { text: unknown }).text === "string"
          ? (first as { text: string }).text
          : null;

    if (args.length === 1) {
      const control = txControlKeyword(stmt);

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

    // A04-G1 PR γ.0 guard (Approach B). Bare control statements have returned
    // above; anything reaching here that is an un-rewriteable tx-control /
    // session statement would execute on the tenant client and corrupt the
    // request transaction. Throw SYNCHRONOUSLY (before any promise is built),
    // matching β1.5's TenantWrapStreamingError posture. Fires in the
    // fall-through path only, so the savepoint stack is untouched. See
    // docs/A04-G1-pr-gamma0-design.md §2.3 / §6.
    if (stmt !== null && isUnrewriteableStatement(stmt.trim().toUpperCase())) {
      throw new TenantWrapUnrewriteableStatementError(stmt);
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
