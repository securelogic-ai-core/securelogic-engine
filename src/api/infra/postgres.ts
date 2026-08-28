import { Pool } from "pg";

import { logger } from "./logger.js";
import { resolvePgSsl } from "./pgSsl.js";
import { resolvePoolTuning, toPoolOptions, type PoolTuning } from "./pgPoolTuning.js";
import type { PoolClient } from "pg";
import {
  tenantStorage,
  createSavepointClient,
  type TenantContext,
  type AfterCommitCallback
} from "./tenantContext.js";

/**
 * Run post-commit callbacks DETACHED (fire-and-forget): the transaction has already
 * committed, so nothing here may block the caller/response or, by throwing, undo a
 * durable write. Each callback is isolated — a rejection is swallowed (callbacks that
 * matter self-log). With an empty list this is a no-op, so the hook is inert when unused.
 */
function runAfterCommit(callbacks: readonly AfterCommitCallback[]): void {
  for (const cb of callbacks) {
    try {
      const p = cb();
      if (p && typeof (p as Promise<void>).then === "function") {
        (p as Promise<void>).catch(() => {});
      }
    } catch {
      /* swallow: the transaction already committed */
    }
  }
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

// Production (Render) Postgres requires TLS, so SSL is on by default — and as
// of P0-1 (hardening batch 2026-08-17) the certificate is VERIFIED by default.
// The full decision matrix, the empirical CA evidence, and every knob
// (DATABASE_SSL_DISABLED for the non-TLS harness, DATABASE_SSL_SERVERNAME for
// internal-hostname DSNs, DATABASE_TLS_NO_VERIFY as the incident rollback
// hatch) live in ./pgSsl.ts, shared with the standalone script pools.
const ssl = resolvePgSsl();

type PoolRole = "app" | "elevated";

export interface PgPoolStats {
  max: number;
  /** Clients currently open (idle + checked out). */
  total: number;
  idle: number;
  /** Callers queued for a client — any value > 0 is saturation. */
  waiting: number;
}

const poolRegistry = new Map<PoolRole, { pool: Pool; tuning: PoolTuning }>();

/** Minimum gap between two `db_pool_saturated` warnings for one pool. */
const SATURATION_WARN_INTERVAL_MS = 30_000;

/**
 * R1-1 observability for one pool:
 *
 *  - `error`: an idle client's connection error is emitted on the pool; with
 *    NO listener node treats it as an unhandled 'error' event and the process
 *    crashes. A saturated or flapping pool must be loud, not fatal.
 *  - saturation: `acquire` fires each time a caller gets a client. If other
 *    callers are still queued at that moment (`waitingCount > 0`) the pool
 *    is oversubscribed — the state that, before R1-1, was an invisible hang.
 *    Logged at WARN, rate-limited per pool so a sustained burst is one line
 *    every 30 s rather than one per checkout.
 */
function attachPoolObservability(target: Pool, role: PoolRole, tuning: PoolTuning): void {
  poolRegistry.set(role, { pool: target, tuning });
  target.on("error", (err) => {
    logger.error(
      { event: "db_pool_error", role, err },
      `${role} pool emitted an error on an idle client`
    );
  });
  let lastSaturationWarnAt = 0;
  target.on("acquire", () => {
    if (target.waitingCount <= 0) return;
    const now = Date.now();
    if (now - lastSaturationWarnAt < SATURATION_WARN_INTERVAL_MS) return;
    lastSaturationWarnAt = now;
    logger.warn(
      { event: "db_pool_saturated", role, ...pgPoolStatsFor(role) },
      `${role} pool is saturated: callers are queued for a client`
    );
  });
}

function pgPoolStatsFor(role: PoolRole): PgPoolStats {
  const entry = poolRegistry.get(role);
  if (!entry) return { max: 0, total: 0, idle: 0, waiting: 0 };
  return {
    max: entry.tuning.max,
    total: entry.pool.totalCount,
    idle: entry.pool.idleCount,
    waiting: entry.pool.waitingCount
  };
}

/**
 * Point-in-time occupancy of both pools, for the ops health surface. Reads
 * counters only — never touches the database, so it stays truthful while the
 * database is the thing that is stuck.
 */
export function pgPoolStats(): Record<PoolRole, PgPoolStats> {
  return { app: pgPoolStatsFor("app"), elevated: pgPoolStatsFor("elevated") };
}

// The application connection pool. Today connects as the DB owner; under
// A04-G1 phase 1+ the DATABASE_URL on the 5 flip-set services repoints to the
// non-owner `app_request` role so RLS policies apply. Internal — callers use
// the `pg` wrapper below.
// R1-1: bounds, not node-postgres' defaults. `connectionTimeoutMillis: 0`
// (the pg default) makes pool exhaustion an INFINITE HANG — no error, no log,
// no metric, health checks still green. See pgPoolTuning.ts for the measured
// connection budget this sizing comes from.
const appPoolTuning = resolvePoolTuning("app", process.env, (detail) =>
  logger.warn(
    { event: "db_pool_tuning_invalid", role: "app", ...detail },
    "Ignoring invalid pool tuning override — using the default"
  )
);

const pool = new Pool({ connectionString: databaseUrl, ssl, ...toPoolOptions(appPoolTuning) });
attachPoolObservability(pool, "app", appPoolTuning);

/**
 * Unwrapped application pool — the documented escape hatch. Performs NO tenant
 * routing and NO BEGIN/COMMIT/ROLLBACK rewriting. A call site that the
 * savepoint proxy does not fit (explicit ISOLATION LEVEL, advisory locks,
 * LISTEN/NOTIFY, COPY, bespoke transaction lifecycle) checks out from here and
 * sets its own `SELECT set_config('app.current_org_id', $1, true)` after BEGIN
 * using requireTenantContext().orgId. See tenantContext.ts header.
 */
export const pgRaw = pool;

/**
 * Elevated (owner) pool for code that legitimately spans tenants — ingestion
 * workers, authAnomaly cross-org reads, signup org-INSERT, the admin operator
 * surface. Mirrors the migrate runner's channel: MIGRATION_DATABASE_URL when
 * set (A04-G1 §6 item 4), else DATABASE_URL. Until the role split lands this is
 * the same connection target as `pool`, so it is inert; the Pool is lazy, so
 * with no callers it opens no connections.
 */
const elevatedUrl = process.env.MIGRATION_DATABASE_URL ?? databaseUrl;
const elevatedPoolTuning = resolvePoolTuning("elevated", process.env, (detail) =>
  logger.warn(
    { event: "db_pool_tuning_invalid", role: "elevated", ...detail },
    "Ignoring invalid pool tuning override — using the default"
  )
);

export const pgElevated = new Pool({
  connectionString: elevatedUrl,
  ssl,
  ...toPoolOptions(elevatedPoolTuning)
});
attachPoolObservability(pgElevated, "elevated", elevatedPoolTuning);

// One line at startup so the deployed budget is a fact in the logs rather than
// something to be re-derived from source during an incident.
logger.info(
  {
    event: "db_pool_configured",
    appPoolMax: appPoolTuning.max,
    elevatedPoolMax: elevatedPoolTuning.max,
    connectionTimeoutMillis: appPoolTuning.connectionTimeoutMillis,
    idleTimeoutMillis: appPoolTuning.idleTimeoutMillis,
    appStatementTimeoutMillis: appPoolTuning.statementTimeoutMillis,
    elevatedStatementTimeoutMillis: elevatedPoolTuning.statementTimeoutMillis
  },
  "Database connection pools configured with explicit bounds"
);

/**
 * M-1 PR-1 (C-2) — strict-mode observability for the raw-pool fallback.
 *
 * When SECURELOGIC_DB_STRICT_TENANT_LOG=true, every `pg.query()` that executes
 * OUTSIDE a withTenant/asTenant scope logs a sampled, structured warning. Under
 * the owner credential this fallback is silently correct; under `app_request`
 * (post-flip) it is the silent-zero-rows failure mode on policied tables — the
 * staging soak reads this signal to find missed wraps empirically before prod.
 * Off by default; zero cost when disabled. Legitimate pre-org-context callers
 * (requireApiKey, attachOrganizationContext, …) will appear here by design and
 * are classified in the C-1 matrix, not silenced in code.
 */
const strictTenantLog = process.env.SECURELOGIC_DB_STRICT_TENANT_LOG === "true";
const strictLogCounts = new Map<string, number>();
const STRICT_LOG_EVERY = 100;
const STRICT_LOG_MAX_KEYS = 500;

function logBareQuery(args: unknown[]): void {
  let caller = "unknown";
  const stack = new Error().stack?.split("\n") ?? [];
  for (const frame of stack.slice(1)) {
    if (!frame.includes("infra/postgres") && frame.includes("at ")) {
      caller = frame.trim().slice(0, 160);
      break;
    }
  }
  const first = args[0];
  const sql =
    typeof first === "string"
      ? first
      : typeof (first as { text?: unknown })?.text === "string"
        ? ((first as { text: string }).text)
        : "";
  const key = caller;
  const n = (strictLogCounts.get(key) ?? 0) + 1;
  if (strictLogCounts.size < STRICT_LOG_MAX_KEYS || strictLogCounts.has(key)) {
    strictLogCounts.set(key, n);
  }
  if (n === 1 || n % STRICT_LOG_EVERY === 0) {
    // Dynamic import would be async; a top-level import is safe (logger has no
    // dependency back into this module).
    logger.warn(
      {
        event: "db_query_outside_tenant_scope",
        caller,
        sqlHead: sql.replace(/\s+/g, " ").slice(0, 120),
        occurrences: n
      },
      "pg.query executed outside any tenant scope (raw-pool fallback)"
    );
  }
}

function tenantAwareQuery(...args: unknown[]): unknown {
  const ctx = tenantStorage.getStore();
  if (ctx) return (ctx.client.query as (...a: unknown[]) => unknown)(...args);
  if (strictTenantLog) logBareQuery(args);
  return (pool.query as (...a: unknown[]) => unknown)(...args);
}

function tenantAwareConnect(...args: unknown[]): unknown {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    if (strictTenantLog) logBareQuery(["<pg.connect>"]);
    return (pool.connect as (...a: unknown[]) => unknown)(...args);
  }
  return Promise.resolve(createSavepointClient(ctx));
}

/**
 * The application database handle. Drop-in for the previous raw Pool: every
 * Pool method/property is forwarded unchanged except `.query()` and
 * `.connect()`, which become tenant-aware. With no active withTenant scope
 * (the state in PR 1 — no middleware wiring, no callers) both route straight
 * to the raw pool, so behaviour is identical to before.
 */
export const pg: Pool = new Proxy(pool, {
  get(target, prop, receiver) {
    if (prop === "query") return tenantAwareQuery;
    if (prop === "connect") return tenantAwareConnect;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function"
      ? (value as (...a: unknown[]) => unknown).bind(target)
      : value;
  }
}) as Pool;

/**
 * Run `fn` scoped to one tenant. Opens a transaction on a dedicated client,
 * sets `app.current_org_id` for the transaction (SET LOCAL semantics via
 * set_config(..., true)), and runs `fn` inside an AsyncLocalStorage scope so
 * `pg.query()` / `pg.connect()` inside `fn` route to this client. Commits on
 * success, rolls back on throw.
 *
 * Exported but NOT wired into middleware in PR 1.
 */
export async function withTenant<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const ctx: TenantContext = { client, orgId, savepoint: { n: 0 }, afterCommit: [] };
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    const result = await tenantStorage.run(ctx, fn);
    await client.query("COMMIT");
    // COMMIT durably succeeded — and only now — fire any post-commit side effects
    // (e.g. notifications). Detached (fire-and-forget) so they never delay the
    // response or the caller; each isolated so one failure can't affect another or
    // the already-committed result. The rollback path below never reaches here, so
    // callbacks registered for a rolled-back transaction are silently discarded.
    runAfterCommit(ctx.afterCommit);
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection may already be unusable; release() below discards it.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` against the elevated (owner) pool, OUTSIDE any tenant scope, so the
 * explicitly-passed client is the only DB handle in play. For legitimately
 * cross-org work. The caller owns any transaction on the passed client.
 *
 * Exported but NOT wired into any caller in PR 1.
 */
export function withElevated<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return tenantStorage.exit(async () => {
    const client = await pgElevated.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  });
}

export { requireTenantContext, currentTenantContext, registerAfterCommit } from "./tenantContext.js";
