import { Pool } from "pg";
import type { PoolClient } from "pg";
import {
  tenantStorage,
  createSavepointClient,
  type TenantContext
} from "./tenantContext.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

// Production (Render) Postgres requires TLS, so SSL is on by default.
// A non-TLS Postgres — the cross-org isolation harness's local/CI Postgres
// (E1-G1) — has no certificate to negotiate; set DATABASE_SSL_DISABLED=true
// in those environments only. Unset (production), behaviour is unchanged.
const sslDisabled =
  process.env.DATABASE_SSL_DISABLED === "true" ||
  process.env.DATABASE_SSL_DISABLED === "1";

const ssl = sslDisabled ? false : { rejectUnauthorized: false };

// The application connection pool. Today connects as the DB owner; under
// A04-G1 phase 1+ the DATABASE_URL on the 5 flip-set services repoints to the
// non-owner `app_request` role so RLS policies apply. Internal — callers use
// the `pg` wrapper below.
const pool = new Pool({ connectionString: databaseUrl, ssl });

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
export const pgElevated = new Pool({ connectionString: elevatedUrl, ssl });

function tenantAwareQuery(...args: unknown[]): unknown {
  const ctx = tenantStorage.getStore();
  if (ctx) return (ctx.client.query as (...a: unknown[]) => unknown)(...args);
  return (pool.query as (...a: unknown[]) => unknown)(...args);
}

function tenantAwareConnect(...args: unknown[]): unknown {
  const ctx = tenantStorage.getStore();
  if (!ctx) return (pool.connect as (...a: unknown[]) => unknown)(...args);
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
  const ctx: TenantContext = { client, orgId, savepoint: { n: 0 } };
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    const result = await tenantStorage.run(ctx, fn);
    await client.query("COMMIT");
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

export { requireTenantContext, currentTenantContext } from "./tenantContext.js";
